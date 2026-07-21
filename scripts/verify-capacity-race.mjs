#!/usr/bin/env node
/**
 * Capacity + hold verification harness (SLUSH).
 *
 * Proves the brief's headline correctness guarantees against the live dev DB:
 *   1. Two students racing for the LAST place → exactly one confirmed, one
 *      waitlisted, and confirmed_count never exceeds capacity (never 301).
 *   2. An expired hold frees the place (swept, pending booking cancelled).
 *
 * Uses the service role for setup/teardown and the authenticated user path for
 * start_booking. Run:  node scripts/verify-capacity-race.mjs
 * (Slice 10 will port this into the automated Vitest/Playwright suite.)
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TRIP = "10000000-0000-0000-0000-000000000001";
const CODE = "BRUMSKI-DEC-26";

const svcHeaders = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const rest = (p, opts = {}) => fetch(`${URL}/rest/v1/${p}`, { ...opts, headers: { ...svcHeaders, ...(opts.headers || {}) } });
const rpc = (fn, body, headers) =>
  fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...svcHeaders, ...(headers || {}) }, body: JSON.stringify(body) });

let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${msg}`);
  if (!cond) failures++;
};

async function makeUser(email) {
  await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password: "Sl0pes-Race-9931x", email_confirm: true }),
  });
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Sl0pes-Race-9931x" }),
  }).then((x) => x.json());
  return r.access_token;
}

async function startBooking(token) {
  const r = await fetch(`${URL}/rest/v1/rpc/start_booking`, {
    method: "POST",
    headers: { apikey: PUB, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: CODE }),
  }).then((x) => x.json());
  return r[0]?.booking_id;
}

const statusOf = async (id) =>
  (await rest(`bookings?id=eq.${id}&select=status`).then((r) => r.json()))[0]?.status;
const confirmedCount = async () =>
  (await rest(`trips?id=eq.${TRIP}&select=confirmed_count`).then((r) => r.json()))[0]?.confirmed_count;

async function cleanup() {
  const users = await rest(`users?select=id&email=like.race_*`).then((r) => r.json());
  const ids = users.map((u) => `"${u.id}"`).join(",");
  if (ids) {
    const bks = await rest(`bookings?user_id=in.(${ids})&select=id`).then((r) => r.json());
    const bids = bks.map((b) => `"${b.id}"`).join(",");
    if (bids) {
      await rest(`payments?booking_id=in.(${bids})`, { method: "DELETE" });
      await rest(`damage_deposits?booking_id=in.(${bids})`, { method: "DELETE" });
      await rest(`bookings?user_id=in.(${ids})`, { method: "DELETE" });
    }
  }
  // delete auth users by email prefix
  const au = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders }).then((r) => r.json());
  for (const u of au.users ?? []) {
    if (u.email?.startsWith("race_")) {
      await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: svcHeaders });
    }
  }
  await rest(`trips?id=eq.${TRIP}`, { method: "PATCH", body: JSON.stringify({ capacity: 300, confirmed_count: 0 }) });
}

async function main() {
  console.log("── Test 1: two racing for the last place (capacity = 1) ──");
  await cleanup();
  await rest(`trips?id=eq.${TRIP}`, { method: "PATCH", body: JSON.stringify({ capacity: 1, confirmed_count: 0 }) });

  const stamp = Date.now();
  const [tokA, tokB] = await Promise.all([makeUser(`race_a_${stamp}@example.com`), makeUser(`race_b_${stamp}@example.com`)]);
  const bookingA = await startBooking(tokA);
  const bookingB = await startBooking(tokB);
  assert(!!bookingA && !!bookingB && bookingA !== bookingB, "two distinct pending bookings created");

  // Fire both finalizes concurrently - the trips-row FOR UPDATE lock serialises them.
  await Promise.all([
    rpc("record_payment_and_finalize", { p_booking_id: bookingA, p_intent_id: `pi_race_a_${stamp}`, p_charge_id: "chA", p_kind: "deposit", p_amount_total: 15000 }),
    rpc("record_payment_and_finalize", { p_booking_id: bookingB, p_intent_id: `pi_race_b_${stamp}`, p_charge_id: "chB", p_kind: "deposit", p_amount_total: 15000 }),
  ]);

  const sA = await statusOf(bookingA);
  const sB = await statusOf(bookingB);
  const cc = await confirmedCount();
  const statuses = [sA, sB].sort().join("+");
  console.log(`  bookingA=${sA}  bookingB=${sB}  confirmed_count=${cc}`);
  assert(statuses === "confirmed+waitlisted", "exactly one confirmed + one waitlisted");
  assert(cc === 1, "confirmed_count === 1 (never exceeded capacity - no 301)");

  console.log("── Test 2: expired hold frees the place ──");
  await cleanup();
  await rest(`trips?id=eq.${TRIP}`, { method: "PATCH", body: JSON.stringify({ capacity: 1, confirmed_count: 0 }) });
  const tokC = await makeUser(`race_c_${stamp}@example.com`);
  const bookingC = await startBooking(tokC);
  const beforeFull = (await rpc("trip_effective_full", { p_trip_id: TRIP }).then((r) => r.json()));
  assert(beforeFull === true, "trip effectively full while the hold is active (capacity 1)");
  // expire the hold
  await rest(`holds?booking_id=eq.${bookingC}`, { method: "PATCH", body: JSON.stringify({ expires_at: "2020-01-01T00:00:00Z" }) });
  await rpc("expire_stale_holds", {});
  const holdStatus = (await rest(`holds?booking_id=eq.${bookingC}&select=status`).then((r) => r.json()))[0]?.status;
  const bookingCStatus = await statusOf(bookingC);
  const afterFull = await rpc("trip_effective_full", { p_trip_id: TRIP }).then((r) => r.json());
  console.log(`  hold=${holdStatus}  booking=${bookingCStatus}  effective_full=${afterFull}`);
  assert(holdStatus === "expired", "hold swept to expired");
  assert(bookingCStatus === "cancelled", "abandoned pending booking cancelled");
  assert(afterFull === false, "place freed (trip no longer effectively full)");

  await cleanup();
  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
