-- Padaya redesign R1: every listing has a town in Romblon (for the island / town filter on Home and Explore),
-- and Tours "coming soon" — customers ask to be told when tours open (Notify me).
-- One sign-up per mobile number (signing up again updates it). Staff with the Rentals permission see the list.

-- ---------------------------------------------------------------- towns
-- The 17 towns of Romblon. Businesses (café, Baybayin…) and stay properties each sit in one; default San Agustin.
create or replace function public.romblon_towns() returns text[]
language sql immutable as $$
  select array['Alcantara', 'Calatrava', 'Ferrol', 'Looc', 'Odiongan', 'San Agustin', 'San Andres', 'Santa Fe', 'Santa Maria',
               'Romblon', 'Cajidiocan', 'Magdiwang', 'San Fernando', 'San Jose', 'Banton', 'Corcuera', 'Concepcion']
$$;
grant execute on function public.romblon_towns() to anon, authenticated;
alter table public.businesses add column if not exists town text not null default 'San Agustin';
alter table public.stay_properties add column if not exists town text not null default 'San Agustin';
do $$ begin
  alter table public.businesses add constraint businesses_town_valid check (town = any (public.romblon_towns()));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stay_properties add constraint stay_properties_town_valid check (town = any (public.romblon_towns()));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tours notify me

insert into public.businesses (slug, name, kind) values ('padaya-tours', 'Padaya Tours', 'tours') on conflict (slug) do nothing;

create table if not exists public.tour_signups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users (id) on delete set null,
  name        text not null check (length(name) between 2 and 80),
  phone       text not null check (phone ~ '^09\d{9}$'),
  email       text check (email is null or email ~ '^\S+@\S+\.\S+$'),
  interests   text[] not null default '{}',
  group_size  int check (group_size is null or group_size between 1 and 50),
  notes       text check (notes is null or length(notes) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (phone)
);
create index if not exists tour_signups_user on public.tour_signups (user_id);

alter table public.tour_signups enable row level security;
drop policy if exists "tour signups staff read" on public.tour_signups;
create policy "tour signups staff read" on public.tour_signups for select to authenticated using (public.has_perm('rentals') or user_id = auth.uid());
drop policy if exists "tour signups staff update" on public.tour_signups;
create policy "tour signups staff update" on public.tour_signups for update to authenticated using (public.has_perm('rentals')) with check (public.has_perm('rentals'));
drop policy if exists "tour signups staff delete" on public.tour_signups;
create policy "tour signups staff delete" on public.tour_signups for delete to authenticated using (public.has_perm('rentals'));
-- no direct insert: customers use tour_notify()

-- the tour ideas customers can tick (kept in one place so the page and the check agree)
create or replace function public.tour_interest_options() returns text[]
language sql immutable as $$
  select array['Island hopping', 'Snorkeling & diving', 'Waterfalls & hikes', 'Beaches & sunsets', 'Food & culture', 'Motorbike tours']
$$;
grant execute on function public.tour_interest_options() to anon, authenticated;

create or replace function public.tour_notify(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := trim(coalesce(p->>'name', ''));
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '[\s-]', '', 'g');
  v_email text := nullif(trim(coalesce(p->>'email', '')), '');
  v_int   text[];
  v_size  int;
  v_new   boolean;
  r       public.tour_signups;
begin
  if length(v_name) < 2 then raise exception 'INVALID: Please enter your name.'; end if;
  if v_phone ~ '^\+?63' then v_phone := '0' || regexp_replace(v_phone, '^\+?63', ''); end if;
  if v_phone !~ '^09\d{9}$' then raise exception 'INVALID: Use the format 09XXXXXXXXX for your mobile number.'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then raise exception 'INVALID: Please check your email address.'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_int
  from jsonb_array_elements_text(coalesce(p->'interests', '[]'::jsonb)) x;
  if not v_int <@ public.tour_interest_options() then raise exception 'INVALID: Please choose from the tour ideas listed.'; end if;
  begin v_size := nullif(p->>'group_size', '')::int;
  exception when others then raise exception 'INVALID: Group size must be a number.'; end;
  if v_size is not null and (v_size < 1 or v_size > 50) then raise exception 'INVALID: Group size must be 1 to 50.'; end if;

  v_new := not exists (select 1 from public.tour_signups where phone = v_phone);
  insert into public.tour_signups (user_id, name, phone, email, interests, group_size, notes)
  values (auth.uid(), v_name, v_phone, v_email, v_int, v_size, nullif(left(trim(coalesce(p->>'notes', '')), 300), ''))
  on conflict (phone) do update set
    user_id = coalesce(excluded.user_id, tour_signups.user_id),
    name = excluded.name, email = coalesce(excluded.email, tour_signups.email),
    interests = excluded.interests, group_size = excluded.group_size, notes = excluded.notes, updated_at = now()
  returning * into r;

  if v_new and r.user_id is not null then
    insert into public.customer_messages (user_id, title, body, link)
    values (r.user_id, 'You''re on the Tours list 🧭', 'We''ll message you as soon as tours open on Padaya.', '/tours');
  end if;
  return jsonb_build_object('new', v_new, 'interests', r.interests);
end $$;
revoke all on function public.tour_notify(jsonb) from public;
grant execute on function public.tour_notify(jsonb) to anon, authenticated;

-- how many people are waiting (shown on the page, no personal details)
create or replace function public.tour_signup_count() returns int
language sql stable security definer set search_path = public as $$ select count(*)::int from public.tour_signups $$;
grant execute on function public.tour_signup_count() to anon, authenticated;
