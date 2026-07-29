#!/usr/bin/env node
/**
 * Capacity + ledger verification harness (SLUSH).
 *
 * SAFETY (this script writes with the service role, which bypasses RLS):
 *   - it REFUSES to run unless the Supabase URL is a local host, so a .env.local
 *     populated from a hosted project cannot be mutated by accident;
 *   - it only ever touches throwaway trips, codes and users it created itself,
 *     and deletes them again on the way out;
 *   - it NEVER writes trips.confirmed_count. Only the locked RPCs write that
 *     column; a harness that PATCHes it detaches the capacity gate from reality.
 *   Note it does call expire_stale_holds(), which sweeps every trip in the
 *   database - exactly what the cron does, and harmless on a local DB.
 *
 * What it proves, deterministically:
 *   1. the capacity gate: with capacity N, payment N+1 is waitlisted and
 *      confirmed_count stops at N (never 301);
 *   2. webhook replay: the same intent applied twice leaves one ledger row per
 *      type and does not double-count capacity;
 *   3. the money: a £150 deposit records £50 to the trip + £100 held, and
 *      pay-in-full clears the balance to zero for the amount actually captured;
 *   4. the sweep: an expired hold frees the place, and a payment landing after
 *      the sweep cancelled the booking still gets a seat;
 *   5. capacity lowered under an admin's hand never confirms anyone else.
 *
 * What it does NOT prove: that the `FOR UPDATE` lock serialises two concurrent
 * finalises. PostgREST gives no way to hold a transaction open and interleave
 * inside the critical section, so the concurrent cases here are stress checks,
 * not a proof - they would pass by accident of scheduling. The deterministic
 * lock proof lives in CI (.github/workflows/ci.yml: one psql session holds the
 * trips row, a second must block inside record_payment_and_finalize).
 *
 * Run:  node scripts/verify-capacity-race.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Config comes from the process env first (CI), falling back to .env.local (dev).
const fileEnv = existsSync(".env.local")
  ? Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    )
  : {};
const env = { ...fileEnv, ...process.env };

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET = env.SUPABASE_SECRET_KEY ?? "";
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const PASSWORD = "Sl0pes-Race-9931x";

function die(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

// ── Guard: local databases only ─────────────────────────────────────────────
// This harness creates users, takes payments and deletes rows. Against a hosted
// project it would corrupt real bookings, so a non-local host is a hard stop.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
if (!SUPABASE_URL || !SECRET || !PUB) {
  die("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (env or .env.local).");
}
let host;
try {
  host = new URL(SUPABASE_URL).hostname.replace(/^\[|\]$/g, "");
} catch {
  die(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${SUPABASE_URL}`);
}
if (!LOCAL_HOSTS.has(host)) {
  die(
    `refusing to run against ${host}. This harness is destructive and only ever runs against a local\n` +
      `   database (npx supabase start). Point NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321 first.`,
  );
}

const svcHeaders = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

/** Every call is checked: a silent 4xx used to turn into a bogus pass. */
async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...svcHeaders, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const insert = (table, row) =>
  rest(table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }).then((r) => r[0]);
const patch = (path, body) => rest(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (path) => rest(path, { method: "DELETE" });

async function rpc(fn, body, headers) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...svcHeaders, ...(headers || {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${msg}`);
  if (!cond) failures++;
};

const runId = randomUUID().slice(0, 8);
/** Everything this run created, torn down in reverse in the finally block. */
const created = { trips: [], userIds: [] };

// ── Fixtures ────────────────────────────────────────────────────────────────
async function createTestTrip(label, capacity) {
  const trip = await insert("trips", {
    name: `Harness ${label} ${runId}`,
    organiser: "Harness",
    resort: "Testville",
    country: "France",
    start_date: "2030-01-10",
    end_date: "2030-01-17",
    nights: 7,
    base_price: 43900,
    deposit_amount: 15000,
    downpayment_amount: 5000,
    damage_deposit_amount: 10000,
    capacity, // confirmed_count is left to its default - only the RPCs write it
    status: "live",
  });
  const code = `HARNESS-${runId}-${label}`.toUpperCase();
  await insert("trip_codes", { trip_id: trip.id, code, active: true });
  created.trips.push(trip.id);
  return { id: trip.id, code };
}

async function makeUser(label) {
  const email = `race_${runId}_${label}@example.com`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const user = await res.json();
  if (!res.ok || !user.id) throw new Error(`create user ${email} -> ${res.status} ${JSON.stringify(user).slice(0, 200)}`);
  created.userIds.push(user.id);
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) throw new Error(`sign in ${email} -> ${tokenRes.status}`);
  return { id: user.id, token: token.access_token };
}

/**
 * Students are pooled and reused across tests: each test books a trip of its
 * own, and the one-live-booking rule is per (student, trip). Signing in 20 times
 * would also trip GoTrue's sign-in rate limit (30 per 5 min) on a re-run.
 */
const pool = [];
async function students(n) {
  while (pool.length < n) pool.push(await makeUser(`s${pool.length}`));
  return pool.slice(0, n);
}

/** Books through the authenticated student path (start_booking, not a direct insert). */
async function startBooking(code, token) {
  const rows = await rpc("start_booking", { p_code: code }, { apikey: PUB, Authorization: `Bearer ${token}` });
  const bookingId = rows?.[0]?.booking_id;
  if (!bookingId) throw new Error(`start_booking returned no booking: ${JSON.stringify(rows).slice(0, 200)}`);
  return bookingId;
}

const finalize = (bookingId, intent, kind, amountTotal) =>
  rpc("record_payment_and_finalize", {
    p_booking_id: bookingId,
    p_intent_id: intent,
    p_charge_id: `ch_${intent}`,
    p_kind: kind,
    p_amount_total: amountTotal,
  });

/**
 * The cron sweep and a payment can deadlock on the same hold row (Postgres
 * aborts one side with 40P01). In production Stripe simply re-delivers the
 * event, so the harness models that rather than reporting a false failure.
 */
async function finalizeRetrying(bookingId, intent, kind, amountTotal) {
  try {
    return await finalize(bookingId, intent, kind, amountTotal);
  } catch (e) {
    if (!/40P01|40001|deadlock|could not serialize/i.test(e.message)) throw e;
    console.log("  (deadlocked with the sweep - retrying, as Stripe's re-delivery would)");
    return finalize(bookingId, intent, kind, amountTotal);
  }
}

const statusOf = async (id) => (await rest(`bookings?id=eq.${id}&select=status`))[0]?.status;
const confirmedCount = async (tripId) => (await rest(`trips?id=eq.${tripId}&select=confirmed_count`))[0]?.confirmed_count;
const paymentsFor = (id) => rest(`payments?booking_id=eq.${id}&select=type,amount,status&order=type`);

/** Deletes only what this run created, and keeps going if one step fails. */
async function teardown() {
  for (const tripId of created.trips) {
    try {
      const bookings = await rest(`bookings?trip_id=eq.${tripId}&select=id`);
      const ids = bookings.map((b) => `"${b.id}"`).join(",");
      if (ids) {
        await del(`payments?booking_id=in.(${ids})`);
        await del(`damage_deposits?booking_id=in.(${ids})`);
        await del(`booking_extras?booking_id=in.(${ids})`);
        await del(`payment_reconciliation_queue?booking_id=in.(${ids})`);
        await del(`crm_outbox?entity_id=in.(${ids})`);
        await del(`holds?booking_id=in.(${ids})`);
        // bookings.user_id is ON DELETE RESTRICT, so bookings go before users.
        await del(`bookings?trip_id=eq.${tripId}`);
      }
      await del(`holds?trip_id=eq.${tripId}`);
      // trip_codes / extras / extra_tiers cascade from the trip.
      await del(`trips?id=eq.${tripId}`);
    } catch (e) {
      console.error(`  teardown: trip ${tripId} not fully removed: ${e.message}`);
    }
  }
  for (const id of created.userIds) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcHeaders }).catch((e) =>
      console.error(`  teardown: user ${id} not removed: ${e.message}`),
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function testCapacityGate() {
  console.log("── Test 1: 12 students racing for 3 places ──");
  const trip = await createTestTrip("gate", 3);
  const users = await students(12);
  const bookings = [];
  for (const u of users) bookings.push(await startBooking(trip.code, u.token));

  await Promise.all(bookings.map((id, i) => finalize(id, `pi_${runId}_gate${i}`, "deposit", 15000)));

  const statuses = await Promise.all(bookings.map(statusOf));
  const confirmed = statuses.filter((s) => s === "confirmed").length;
  const waitlisted = statuses.filter((s) => s === "waitlisted").length;
  const cc = await confirmedCount(trip.id);
  console.log(`  confirmed=${confirmed} waitlisted=${waitlisted} confirmed_count=${cc}`);
  assert(confirmed === 3, "exactly 3 confirmed (capacity 3)");
  assert(waitlisted === 9, "the other 9 are waitlisted, not rejected");
  assert(cc === 3, "confirmed_count === capacity - never exceeded");
}

async function testLastPlaceRace() {
  console.log("── Test 2: two racing for the last place (capacity 1) ──");
  const trip = await createTestTrip("last", 1);
  const [a, b] = await students(2);
  const bookingA = await startBooking(trip.code, a.token);
  const bookingB = await startBooking(trip.code, b.token);
  assert(bookingA !== bookingB, "two distinct pending bookings created");

  await Promise.all([
    finalize(bookingA, `pi_${runId}_lastA`, "deposit", 15000),
    finalize(bookingB, `pi_${runId}_lastB`, "deposit", 15000),
  ]);

  const pair = [await statusOf(bookingA), await statusOf(bookingB)].sort().join("+");
  const cc = await confirmedCount(trip.id);
  console.log(`  statuses=${pair} confirmed_count=${cc}`);
  assert(pair === "confirmed+waitlisted", "exactly one confirmed + one waitlisted");
  assert(cc === 1, "confirmed_count === 1 (no 301)");
}

async function testDepositLedgerAndReplay() {
  console.log("── Test 3: deposit ledger + webhook replay ──");
  const trip = await createTestTrip("replay", 5);
  const [user] = await students(1);
  const booking = await startBooking(trip.code, user.token);
  const intent = `pi_${runId}_replay`;

  const first = await finalize(booking, intent, "deposit", 15000);
  // Stripe retries a delivered event; the webhook must be idempotent.
  const second = await finalize(booking, intent, "deposit", 15000);
  const pays = await paymentsFor(booking);
  const cc = await confirmedCount(trip.id);
  const damage = await rest(`damage_deposits?booking_id=eq.${booking}&select=amount,status`);
  const balance = await rpc("booking_balance", { p_booking_id: booking });

  console.log(`  first=${first} replay=${second} rows=${pays.length} confirmed_count=${cc} balance=${balance}`);
  assert(first === "confirmed" && second === "confirmed", "both applications report confirmed");
  assert(pays.length === 2, "exactly 2 ledger rows after the replay (no duplicates)");
  assert(pays.some((p) => p.type === "deposit" && p.amount === 5000), "£50 downpayment recorded against the trip");
  assert(pays.some((p) => p.type === "damage_deposit_hold" && p.amount === 10000), "£100 damage deposit recorded separately");
  assert(damage.length === 1 && damage[0].amount === 10000 && damage[0].status === "held", "one damage_deposits row, held");
  assert(cc === 1, "replay did not double-count capacity");
  assert(balance === 43900 - 5000, "balance = trip cost - £50 downpayment");
}

async function testPayInFull() {
  console.log("── Test 4: pay in full clears the balance ──");
  const trip = await createTestTrip("full", 5);
  const extra = await insert("extras", {
    trip_id: trip.id,
    type: "transport",
    name: "Return coach transport",
    price: 23900,
    sort_order: 1,
    active: true,
  });
  const [user] = await students(1);
  const booking = await startBooking(trip.code, user.token);
  await insert("booking_extras", { booking_id: booking, extra_id: extra.id, quantity: 1, price_at_booking: 23900 });

  const cost = await rpc("compute_trip_cost", { p_booking_id: booking });
  assert(cost === 43900 + 23900, "trip cost = base price + snapshotted extra");
  // Pay in full = trip cost + the £100 damage deposit, in one charge.
  const status = await finalize(booking, `pi_${runId}_full`, "full", cost + 10000);
  const pays = await paymentsFor(booking);
  const balance = await rpc("booking_balance", { p_booking_id: booking });

  console.log(`  status=${status} balance=${balance}`);
  assert(status === "confirmed", "confirmed");
  assert(pays.some((p) => p.type === "deposit" && p.amount === cost), "trip money recorded = charge minus the damage deposit");
  assert(pays.some((p) => p.type === "damage_deposit_hold" && p.amount === 10000), "£100 damage deposit held");
  assert(balance === 0, "balance cleared to zero");
}

async function testSweepFreesPlaceThenPaymentLands() {
  console.log("── Test 5: expired hold frees the place, a late payment still gets a seat ──");
  const trip = await createTestTrip("sweep", 1);
  const [user] = await students(1);
  const booking = await startBooking(trip.code, user.token);
  assert((await rpc("trip_effective_full", { p_trip_id: trip.id })) === true, "trip effectively full while the hold is active");

  await patch(`holds?booking_id=eq.${booking}`, { expires_at: "2020-01-01T00:00:00Z" });
  await rpc("expire_stale_holds", {});
  const holdStatus = (await rest(`holds?booking_id=eq.${booking}&select=status`))[0]?.status;
  assert(holdStatus === "expired", "hold swept to expired");
  assert((await statusOf(booking)) === "cancelled", "abandoned pending booking cancelled");
  assert((await rpc("trip_effective_full", { p_trip_id: trip.id })) === false, "place freed");

  // The student's card succeeded after the sweep ran: they paid, so they get a seat.
  const status = await finalize(booking, `pi_${runId}_sweep`, "deposit", 15000);
  console.log(`  status after late payment=${status} confirmed_count=${await confirmedCount(trip.id)}`);
  assert(status === "confirmed", "payment landing after the sweep is placed, not lost");
  assert((await confirmedCount(trip.id)) === 1, "confirmed_count === 1");
}

async function testSweepRacingPayment() {
  console.log("── Test 6: the sweep racing a payment (stress) ──");
  const trip = await createTestTrip("race", 1);
  const [user] = await students(1);
  const booking = await startBooking(trip.code, user.token);
  await patch(`holds?booking_id=eq.${booking}`, { expires_at: "2020-01-01T00:00:00Z" });

  // Either order must end the same way: the student paid, so they hold a place.
  await Promise.all([
    rpc("expire_stale_holds", {}),
    finalizeRetrying(booking, `pi_${runId}_race`, "deposit", 15000),
  ]);
  const status = await statusOf(booking);
  const cc = await confirmedCount(trip.id);
  console.log(`  status=${status} confirmed_count=${cc}`);
  assert(status === "confirmed", "paid booking not left cancelled by the sweep");
  assert(cc === 1, "confirmed_count === 1");
}

async function testCapacityLoweredMidFlight() {
  console.log("── Test 7: admin lowers capacity mid-flight ──");
  const trip = await createTestTrip("lower", 2);
  const [a, b] = await students(2);
  const bookingA = await startBooking(trip.code, a.token);
  const bookingB = await startBooking(trip.code, b.token);

  assert((await finalize(bookingA, `pi_${runId}_lowerA`, "deposit", 15000)) === "confirmed", "first student confirmed");
  // The admin edits capacity down to what is already sold (CMS-editable data).
  await patch(`trips?id=eq.${trip.id}`, { capacity: 1 });
  const second = await finalize(bookingB, `pi_${runId}_lowerB`, "deposit", 15000);
  const cc = await confirmedCount(trip.id);
  console.log(`  second=${second} confirmed_count=${cc}`);
  assert(second === "waitlisted", "the next payment waitlists against the lowered capacity");
  assert(cc === 1, "confirmed_count still 1 - a lowered capacity is never overrun");
}

async function main() {
  console.log(`SLUSH capacity harness - run ${runId} against ${host}\n`);
  try {
    await testCapacityGate();
    await testLastPlaceRace();
    await testDepositLedgerAndReplay();
    await testPayInFull();
    await testSweepFreesPlaceThenPaymentLands();
    await testSweepRacingPayment();
    await testCapacityLoweredMidFlight();
  } finally {
    await teardown();
  }
  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  // main()'s finally has already torn down whatever this run created.
  console.error("harness error:", e);
  process.exit(1);
});
