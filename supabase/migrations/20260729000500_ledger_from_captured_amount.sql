-- ─────────────────────────────────────────────────────────────────────────
-- Post-remediation review fixes (review findings 12, 17, 18, 36, 37, 38).
--
-- record_payment_and_finalize and expire_stale_holds below are the 20260729000200
-- definitions with ONLY the edits named here applied. They were re-created rather
-- than ALTERed because plpgsql has no partial replace - diff them against 000200
-- and you should see exactly the changes described, nothing else.
--
--   #18  the deposit branch ledgered the CONFIGURED split instead of the amount
--        Stripe captured, so an admin editing the deposit while a student held a
--        live client secret wrote money into the ledger that never arrived
--   #38  the #14 sweep exemption was unbounded, so a checkout abandoned at the
--        pay screen could never be reaped
--   #12  #58's column restriction reached `anon` only; a signed-in student could
--        still read the exact remaining-places number over PostgREST
--   #17  the layer-3 in-body guards tested auth.uid(), which is NULL for the
--        `anon` role they were written to stop
--   #37  the reconciliation dedupe index was not partial, so it deduped for all
--        time instead of "one OPEN row per (intent, reason)" as documented
--   #36  000300's duplicate cleanup kept the OLDEST row, reverting the
--        last-write-wins semantics the app relies on
-- ─────────────────────────────────────────────────────────────────────────

-- ── #37: dedupe only OPEN reconciliation rows ──────────────────────────────
-- The index was documented as "one open row per (intent, reason)" but carried no
-- predicate, so once a human resolved a row the same (intent, reason) could never
-- be queued again: ON CONFLICT DO NOTHING swallowed it silently. Every arbiter
-- referencing it now repeats the predicate, as a partial index requires.
drop index if exists public.payment_reconciliation_intent_reason_uidx;
create unique index payment_reconciliation_intent_reason_uidx
  on public.payment_reconciliation_queue(stripe_payment_intent_id, reason)
  where resolved_at is null;

-- ── #36: keep the NEWEST of a duplicate pair, not the oldest ───────────────
-- emergency_contacts and consents are written delete-then-insert, so the app's
-- semantics are last-write-wins. 000300's pre-index cleanup kept the EARLIEST row
-- of each group - the version the student had already overwritten. A corrected
-- emergency phone number silently reverted to the wrong one, and a consents row
-- reverted to an earlier terms_version, which is the legal record of acceptance.
-- 000300 has already run, so this repeats the cleanup with the comparison the
-- right way round; it is a no-op unless duplicates survived. booking_extras is
-- deliberately left alone: those rows are interchangeable.
delete from public.emergency_contacts ec
 where exists (
   select 1 from public.emergency_contacts keep
    where keep.user_id = ec.user_id
      and (keep.created_at, keep.id) > (ec.created_at, ec.id)
 );

delete from public.consents c
 where exists (
   select 1 from public.consents keep
    where keep.booking_id = c.booking_id
      and (keep.created_at, keep.id) > (c.created_at, c.id)
 );

-- ── #12: the remaining-places number is not for students either ────────────
-- 000300 restricted these columns for `anon` only. The audience the brief
-- actually forbids from seeing a places-remaining count is the logged-in student,
-- and `authenticated` still held table-wide SELECT: lift the publishable key and
-- your own access token out of the page and
-- GET /rest/v1/trips?select=capacity,confirmed_count returns 300 and 287.
--
-- SAFE ONLY BECAUSE THE READS WERE NARROWED FIRST. Under a column-level grant
-- `select("*")` fails outright rather than returning a subset, so lib/db/queries.ts
-- now selects TRIP_COLUMNS (these exact 17) everywhere it reads trips as the user.
-- Add a trips column the student-facing app needs and you must add it to BOTH
-- lists or those pages 401. The service-role client (admin screens, webhook, CRM
-- drain) bypasses grants and is unaffected.
revoke select on public.trips from authenticated;
grant select (
  id, name, organiser, resort, country, start_date, end_date, nights,
  base_price, base_inclusions, deposit_amount, downpayment_amount,
  damage_deposit_amount, balance_due_date, description, status, created_at
) on public.trips to authenticated;

-- ── #17 + #18: guard on the ROLE, and ledger what was captured ─────────────
-- #17: the guard was `if auth.uid() is not null then raise`. auth.uid() reads the
-- `sub` claim, and a request carrying ONLY the publishable key runs as `anon` with
-- no claims at all - so auth.uid() was NULL and the guard passed for exactly the
-- caller 20260729000100 describes. Layers 1 and 2 (the revokes) are what close
-- that hole; this layer exists in case a future migration restores a grant by
-- accident, so it has to test the role: raise when request.jwt.claims is present
-- AND the claimed role is not service_role. Allowing service_role explicitly
-- matters - inferring it from the ABSENCE of claims would break the webhook if a
-- service-role connection turns out to populate them.
create or replace function public.record_payment_and_finalize(
  p_booking_id   uuid,
  p_intent_id    text,
  p_charge_id    text,
  p_kind         text,
  p_amount_total integer
)
returns public.booking_status
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_trip           uuid;
  v_user           uuid;
  v_status         public.booking_status;
  v_capacity       int;
  v_confirmed      int;
  v_reserved       int;
  v_downpay        int;
  v_damage         int;
  v_trip_paid      int;
  v_sibling        uuid;
  v_sibling_status public.booking_status;
  v_sibling_intent text;
begin
  -- Webhook / reconcile only. Tests the ROLE, not auth.uid(): a publishable-key
  -- request runs as `anon` with no `sub`, so the old uid check passed for exactly
  -- the caller it was written to stop (review #17). service_role is allowed
  -- explicitly rather than inferred from the ABSENCE of claims, because whether a
  -- service-role connection populates request.jwt.claims depends on the key
  -- format - assuming it does not would break the webhook on this line.
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  -- lock the booking first (serialises finalise for this booking),
  -- then the trip (serialises capacity across racers). Consistent order.
  select b.trip_id, b.user_id, b.status
    into v_trip, v_user, v_status
    from public.bookings b
   where b.id = p_booking_id
   for update;
  if v_trip is null then raise exception 'booking not found'; end if;

  -- #2/#5/#12: promoting a cancelled booking can collide with a newer live
  -- booking for the same student+trip on bookings_one_live_per_user_trip. Take
  -- that lock NOW, while we are still in the bookings stage of the lock order.
  -- (No cycle: a pending/confirmed booking never looks for a sibling, so two
  -- concurrent finalises can never wait on each other's booking row.)
  if p_kind in ('deposit', 'full') and v_status = 'cancelled' then
    select b.id, b.status, b.payment_intent_id
      into v_sibling, v_sibling_status, v_sibling_intent
      from public.bookings b
     where b.user_id = v_user and b.trip_id = v_trip
       and b.id <> p_booking_id
       and b.status not in ('cancelled', 'refunded')
     limit 1
     for update;
  end if;

  select t.capacity, t.confirmed_count, t.downpayment_amount, t.damage_deposit_amount
    into v_capacity, v_confirmed, v_downpay, v_damage
    from public.trips t where t.id = v_trip
   for update;

  if p_kind in ('deposit', 'full') then
    -- ── 1. THE LEDGER, FIRST ──────────────────────────────────────────────
    -- Stripe has the money. These rows are written before anything that can
    -- fail, so a placement problem below can never roll back the record of a
    -- captured charge (audit #2/#5/#12).
    -- #18: BOTH kinds attribute what Stripe actually captured. The 'full' branch
    -- always did; 'deposit' used to write the split read live from trips, so an
    -- admin editing the deposit while a student held a client secret minted at
    -- the old price made the ledger claim money that never arrived - and set
    -- refundDamage up to return more than was taken. The damage deposit is the
    -- refundable part so it is satisfied first; whatever remains is trip money,
    -- which means a short capture can never manufacture trip money.
    v_damage    := least(v_damage, p_amount_total);
    v_trip_paid := p_amount_total - v_damage;

    -- The rows above are right either way, but a capture that disagrees with the
    -- configured split means the trip was edited mid-checkout. Tell a human.
    if p_amount_total <> v_downpay + v_damage then
      insert into public.payment_reconciliation_queue
          (booking_id, stripe_payment_intent_id, stripe_charge_id, amount, reason, metadata)
        values (p_booking_id, p_intent_id, nullif(p_charge_id, ''), p_amount_total,
                'split_changed_mid_checkout',
                jsonb_build_object('captured', p_amount_total,
                                   'configured_downpayment', v_downpay,
                                   'configured_damage', v_damage,
                                   'payment_kind', p_kind))
        on conflict (stripe_payment_intent_id, reason) where resolved_at is null do nothing;
    end if;

    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'deposit', v_trip_paid, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;

    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'damage_deposit_hold', v_damage, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;

    -- #1/#55: one damage deposit per booking, for ever. The pre-check keeps a
    -- refunded row (outside the old partial index) from being re-armed as a
    -- fresh 'held' one; the ON CONFLICT is the concurrency backstop.
    if not exists (select 1 from public.damage_deposits d
                    where d.booking_id = p_booking_id) then
      insert into public.damage_deposits (booking_id, amount, status, stripe_payment_intent_id)
        values (p_booking_id, v_damage, 'held', p_intent_id)
        on conflict (booking_id, stripe_payment_intent_id) do nothing;
    end if;

    -- ── 2. THE PLACEMENT ──────────────────────────────────────────────────
    -- #3 (earlier audit): also place a booking the sweep cancelled after its
    -- hold expired - the customer paid, so they get a seat (or the waiting
    -- list). 'refunded' stays terminal and is never resurrected.
    if v_status in ('pending', 'cancelled') then
      if v_sibling is not null then
        if v_sibling_status = 'pending'
           and v_sibling_intent is null
           and not exists (select 1 from public.payments p
                            where p.booking_id = v_sibling and p.status = 'succeeded') then
          -- An empty unpaid shell: the student started over, then their first
          -- payment landed. Retire the shell so the paid booking takes the
          -- place. We refuse to touch a shell with its own live intent - that
          -- would strand a second chargeable intent (the double-charge shape).
          update public.bookings set status = 'cancelled' where id = v_sibling and status = 'pending';
          update public.holds set status = 'released'
           where booking_id = v_sibling and status = 'active';
          v_sibling := null;
        end if;
      end if;

      if v_sibling is not null then
        -- The student holds another PAID booking (or one mid-payment) for this
        -- trip, so this charge cannot be placed without breaking the one-live-
        -- booking rule. The ledger above stands; queue it for a human refund
        -- rather than raising, which would 500 the webhook for three days and
        -- leave the money invisible (audit #2/#5/#12).
        insert into public.payment_reconciliation_queue
            (booking_id, stripe_payment_intent_id, stripe_charge_id, amount, reason, metadata)
          values (p_booking_id, p_intent_id, nullif(p_charge_id, ''), p_amount_total,
                  'live_sibling_booking',
                  jsonb_build_object('sibling_booking_id', v_sibling,
                                     'sibling_status', v_sibling_status,
                                     'payment_kind', p_kind))
          on conflict (stripe_payment_intent_id, reason) where resolved_at is null do nothing;
      else
        begin
          -- #94: waitlisters reserve a place each, so a newcomer paying just
          -- after the admin raised capacity joins the back of the queue instead
          -- of taking the bed the queue was waiting for. confirmed_count can
          -- still never exceed capacity: v_reserved >= 0.
          select count(*) into v_reserved
            from public.bookings b
           where b.trip_id = v_trip and b.status = 'waitlisted'
             and b.id <> p_booking_id;

          if v_confirmed + v_reserved < v_capacity then
            update public.bookings set status = 'confirmed' where id = p_booking_id;
            update public.trips set confirmed_count = confirmed_count + 1 where id = v_trip;
            v_status := 'confirmed';
          else
            update public.bookings set status = 'waitlisted' where id = p_booking_id;
            v_status := 'waitlisted';
          end if;
        exception when unique_violation then
          -- Final backstop: something else claimed the live-booking slot
          -- between our lock and this UPDATE. v_status is untouched (the flip
          -- raised before it was assigned), the ledger above survives because
          -- only this block rolls back, and a human picks the payment up.
          insert into public.payment_reconciliation_queue
              (booking_id, stripe_payment_intent_id, stripe_charge_id, amount, reason, metadata)
            values (p_booking_id, p_intent_id, nullif(p_charge_id, ''), p_amount_total,
                    'placement_conflict',
                    jsonb_build_object('booking_status', v_status, 'payment_kind', p_kind))
            on conflict (stripe_payment_intent_id, reason) where resolved_at is null do nothing;
        end;
      end if;
    end if;

    update public.holds set status = 'consumed'
     where booking_id = p_booking_id and status = 'active';

    -- The live intent has been consumed; clear the guard so it can't be re-cancelled.
    update public.bookings set payment_intent_id = null where id = p_booking_id;

  elsif p_kind = 'balance' then
    insert into public.payments (booking_id, stripe_payment_intent_id, stripe_charge_id, type, amount, status)
      values (p_booking_id, p_intent_id, p_charge_id, 'balance', p_amount_total, 'succeeded')
      on conflict (stripe_payment_intent_id, type) where stripe_payment_intent_id is not null do nothing;
  else
    raise exception 'unknown payment kind: %', p_kind;
  end if;

  return v_status;
end;
$$;

-- ── #38: let the sweep reclaim an abandoned checkout ───────────────────────
create or replace function public.expire_stale_holds()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_count int;
begin
  -- cron/service-role only. Role-based for the reason given in finalize above.
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  update public.holds set status = 'expired'
   where status = 'active' and expires_at <= now();
  get diagnostics v_count = row_count;

  -- Cancel abandoned pending bookings, but NEVER one carrying a PaymentIntent:
  -- payments rows only exist after finalise, so a booking mid-3DS looks
  -- abandoned to this sweep, and cancelling it is what stranded the charge.
  -- Those bookings keep their row; start_booking hands them back with a fresh
  -- hold, and finalise clears payment_intent_id once the intent is consumed.
  update public.bookings b set status = 'cancelled'
   where b.status = 'pending'
     -- #38: a live intent protects a booking, but only for 24 hours.
     -- payment_intent_id is cleared only by finalise or the app, and
     -- payment_intent.canceled deliberately does not clear it - so an absolute
     -- exemption left a checkout abandoned at the pay screen 'pending' for ever:
     -- a phantom row on the student's dashboard and in every admin export. 24h
     -- is far beyond both the 30-minute hold and any 3DS flow.
     and (b.payment_intent_id is null or b.created_at < now() - interval '24 hours')
     and not exists (select 1 from public.holds h
                      where h.booking_id = b.id and h.status = 'active' and h.expires_at > now())
     and not exists (select 1 from public.payments p
                      where p.booking_id = b.id and p.status = 'succeeded');
  return v_count;
end;
$$;
revoke all on function public.record_payment_and_finalize(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_payment_and_finalize(uuid, text, text, text, integer)
  to service_role;
revoke all on function public.expire_stale_holds() from public, anon, authenticated;
grant execute on function public.expire_stale_holds() to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICATION - paste into the Supabase SQL editor after applying.
--
-- 1. A student must not be able to read the remaining-places number.
--    Expect false:
--      select has_column_privilege('authenticated','public.trips','capacity','select')
--          or has_column_privilege('authenticated','public.trips','confirmed_count','select');
--    Expect true, so the booking flow still works:
--      select has_column_privilege('authenticated','public.trips','base_price','select');
--
-- 2. The privileged functions stay unreachable from a browser session.
--    Expect zero rows:
--      select p.proname, r.rolname
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--        cross join (values ('anon'),('authenticated')) as r(rolname)
--       where n.nspname = 'public'
--         and p.proname in ('record_payment_and_finalize','expire_stale_holds')
--         and has_function_privilege(r.rolname, p.oid, 'execute');
--
-- 3. The reconciliation dedupe is partial. Expect a WHERE in the definition:
--      select indexdef from pg_indexes
--       where indexname = 'payment_reconciliation_intent_reason_uidx';
--
-- 4. Nothing is stranded. Investigate anything this returns:
--      select booking_id, reason, amount, created_at
--        from public.payment_reconciliation_queue where resolved_at is null;
-- ─────────────────────────────────────────────────────────────────────────
