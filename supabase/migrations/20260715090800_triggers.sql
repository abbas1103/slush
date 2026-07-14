-- ─────────────────────────────────────────────────────────────────────────
-- Auth trigger: mirror every new auth.users row into public.users so the app
-- always has a profile to attach booking data to. Runs as definer (postgres).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
