-- ─────────────────────────────────────────────────────────────────────────
-- CRM sync: an outbox queue + enqueue trigger. CRM-agnostic — the app writes
-- events here whenever a booking is finalised/refunded; a processor (with the
-- configured adapter) pushes them to whichever CRM is chosen later. Reliable
-- (survives crashes / retries) and decoupled from the request path.
-- ─────────────────────────────────────────────────────────────────────────

create type crm_outbox_status as enum ('pending', 'sent', 'failed');

create table crm_outbox (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,                 -- 'booking_sync'
  entity_id  uuid not null,                 -- booking id
  status     crm_outbox_status not null default 'pending',
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index crm_outbox_pending_idx on crm_outbox(created_at)
  where status in ('pending', 'failed');

alter table crm_outbox enable row level security;
grant select on crm_outbox to authenticated; -- admins only (policy below); writes via trigger/service role
create policy crm_outbox_admin_read on crm_outbox
  for select to authenticated using (public.is_admin());

-- Enqueue a sync event whenever a booking's status changes to a state the CRM
-- cares about. Coalescing/idempotency is the adapter's job (upsert by reference).
create or replace function public.enqueue_crm_booking_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('confirmed', 'converted', 'refunded', 'cancelled') then
    insert into public.crm_outbox (event_type, entity_id) values ('booking_sync', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists booking_crm_sync on public.bookings;
create trigger booking_crm_sync
  after update on public.bookings
  for each row execute function public.enqueue_crm_booking_sync();
