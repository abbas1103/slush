-- ─────────────────────────────────────────────────────────────────────────
-- Seed: the first trip (Brumski Christmas Trip) with its code and all extras.
-- Everything here is editable by admins later - nothing about it is hardcoded
-- in the app. Re-running it only FILLS GAPS: every insert is ON CONFLICT DO
-- NOTHING (no target, so any unique clash is skipped), because DO UPDATE would
-- overwrite exactly the admin-editable data the CMS owns - prices, capacity,
-- trip status, whether a trip code is still active - with no audit_log entry.
-- Change those in the admin CMS, never here.
-- Prices in integer pence. Equipment prices are PROVISIONAL (brief: confirm
-- before launch, in the CMS); Race day / Railjam are TBC.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.trips
  (id, name, organiser, resort, country, start_date, end_date, nights, base_price,
   base_inclusions, deposit_amount, downpayment_amount, damage_deposit_amount,
   balance_due_date, capacity, description, status)
values
  ('10000000-0000-0000-0000-000000000001',
   'Brumski Christmas Trip', 'Brumski', 'Alpe d''Huez', 'France',
   '2026-12-12', '2026-12-19', 7, 43900,
   '["7 nights, 3★ accommodation", "Full 6-day Alpe d''Huez lift pass", "Trip tee shirt"]'::jsonb,
   15000, 5000, 10000, '2026-11-15', 300,
   'Seven nights in Alpe d''Huez with Brumski - 250km of sunny, south-facing pistes for every level, home to the Sarenne, one of the longest black runs in the world. One booking covers your stay, your lift pass and your trip tee.',
   'live')
on conflict do nothing;

insert into public.trip_codes (id, trip_id, code, active)
values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'BRUMSKI-DEC-26', true)
on conflict do nothing;

insert into public.extras
  (id, trip_id, type, name, description, price, price_tbc, has_quality_tiers, single_select_group, sort_order, active)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'transport', 'Return coach transport', 'Birmingham → Alpe d''Huez, both ways', 23900, false, false, null, 1, true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'equipment', 'Skis, Boots & Poles', 'Choose your quality level', null, false, true, 'equipment_rental', 2, true),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'equipment', 'Snowboard & Boots', 'All-in snowboard package', 8900, false, false, 'equipment_rental', 3, true),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'equipment', 'Skis / Snowboard only', 'Board or skis, no boots', 5900, false, false, 'equipment_rental', 4, true),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'equipment', 'Boots only', null, 2900, false, false, 'equipment_rental', 5, true),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'equipment', 'Helmet', null, 1500, false, false, 'equipment_rental', 6, true),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'lessons', 'Ski lessons', '6 hours total - 3 lessons of 2 hours', 9000, false, false, null, 7, true),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'event', 'Opening Après', null, 1100, false, false, null, 8, true),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'event', 'Brumski Club Night', null, 1100, false, false, null, 9, true),
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'event', 'Headliner', null, 2000, false, false, null, 10, true),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'event', 'Race day', 'Details coming soon', null, true, false, null, 11, true),
  ('30000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'event', 'Railjam', 'Details coming soon', null, true, false, null, 12, true),
  ('30000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 'other', 'Winter sports cover', 'Medical, piste closure, kit & cancellation', 4200, false, false, null, 13, true)
on conflict do nothing;

insert into public.extra_tiers (id, extra_id, name, price, sort_order)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Economy', 7900, 1),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Evolution', 9900, 2),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'Performance', 12900, 3),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Excellence', 16900, 4)
on conflict do nothing;
