-- ─────────────────────────────────────────────────────────────────────────
-- Supporting tables (GDPR consent records, admin/audit trail) and the
-- capacity read model.
-- ─────────────────────────────────────────────────────────────────────────

-- Versioned consent records. No pre-ticked boxes: marketing/health defaults false.
create table consents (
  id                             uuid primary key default gen_random_uuid(),
  user_id                        uuid references users(id) on delete cascade,
  booking_id                     uuid references bookings(id) on delete cascade,
  terms_version                  text,
  terms_accepted_at              timestamptz,
  marketing_opt_in               boolean not null default false,
  marketing_opt_in_at            timestamptz,
  health_data_consent            boolean not null default false,   -- access/medical needs (Art. 9)
  health_data_consent_at         timestamptz,
  share_access_needs_with_resort boolean not null default false,
  share_access_needs_at          timestamptz,
  created_at                     timestamptz not null default now()
);
create index consents_user_idx    on consents(user_id);
create index consents_booking_idx on consents(booking_id);

-- Append-only audit trail for admin mutations and every refund.
-- metadata holds NO PII — only references, amounts, and old→new status.
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email   text,
  action        text not null,        -- e.g. trip_update, refund_issued, waitlist_convert
  target_type   text,
  target_id     uuid,
  metadata      jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);
create index audit_log_target_idx  on audit_log(target_type, target_id);
create index audit_log_created_idx on audit_log(created_at desc);

-- ── Capacity read model ──────────────────────────────────────────────────
-- SERVER-ONLY view (not exposed to client roles): it counts ALL active holds
-- across users, which the brief forbids surfacing to students ("never a
-- remaining-places number"). The app derives only a boolean "full?" for the UI.
-- Runs with the view owner's privileges so hold counts are complete.
create view trip_availability as
select
  t.id                                                              as trip_id,
  t.capacity,
  t.confirmed_count,
  coalesce(h.active_hold_count, 0)                                  as active_hold_count,
  t.confirmed_count >= t.capacity                                   as is_full,
  (t.confirmed_count + coalesce(h.active_hold_count, 0)) >= t.capacity as effective_full
from trips t
left join (
  select trip_id, count(*)::int as active_hold_count
  from holds
  where status = 'active' and expires_at > now()
  group by trip_id
) h on h.trip_id = t.id;
