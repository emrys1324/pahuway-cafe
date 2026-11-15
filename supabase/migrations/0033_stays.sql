-- Padaya 2.0, Phase 3: accommodations ("Stays").
-- Properties → room types (with N identical rooms) → bookings by night. Customers pick check-in/check-out,
-- guests, add an ID photo and a GCash deposit receipt; staff verify, check in, check out. A night is taken
-- when every room of that type is booked for it. Managed by staff with the "rentals" permission.

insert into public.businesses (slug, name, kind) values ('padaya-stays', 'Padaya Stays', 'stays') on conflict (slug) do nothing;

create table if not exists public.stay_settings (
  id                  int primary key default 1 check (id = 1),
  bookings_enabled    boolean not null default false,
  deposit_percent     int not null default 30 check (deposit_percent between 1 and 100),
  free_cancel_days    int not null default 3 check (free_cancel_days between 0 and 60),
  max_nights          int not null default 30 check (max_nights between 1 and 90),
  terms               text,   -- house rules / cancellation policy shown before paying
  updated_at          timestamptz not null default now()
);
insert into public.stay_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.stay_properties (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references public.businesses (id) default null,
  name            text not null check (length(name) between 2 and 80),
  description     text,
  location_text   text,
  map_url         text check (map_url is null or map_url ~ '^https://'),
  photos          text[] not null default '{}',
  amenities       text[] not null default '{}',
  house_rules     text,
  check_in_time   time not null default '14:00',
  check_out_time  time not null default '11:00',
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.stay_rooms (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.stay_properties (id) on delete cascade,
  name          text not null check (length(name) between 2 and 80),
  description   text,
  photos        text[] not null default '{}',
  amenities     text[] not null default '{}',
  nightly_rate  numeric(10,2) not null check (nightly_rate >= 0),
  weekend_rate  numeric(10,2) check (weekend_rate is null or weekend_rate >= 0),   -- Fri & Sat nights; null = same
  max_guests    int not null default 2 check (max_guests between 1 and 30),
  units         int not null default 1 check (units between 1 and 100),          -- identical rooms of this type
  min_nights    int not null default 1 check (min_nights between 1 and 30),
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create sequence if not exists public.stay_booking_seq;
create table if not exists public.stay_bookings (
  id                uuid primary key default gen_random_uuid(),
  booking_number    text not null unique default ('ST-' || lpad(nextval('public.stay_booking_seq')::text, 4, '0')),
  public_token      uuid not null unique default gen_random_uuid(),
  room_id           uuid not null references public.stay_rooms (id),
  room_name         text not null,
  property_name     text not null,
  customer_user_id  uuid references public.users (id) on delete set null,
  customer_name     text not null,
  customer_phone    text not null,
  customer_email    text,
  check_in          date not null,
  check_out         date not null,
  nights            int not null check (nights >= 1),
  guests            int not null check (guests >= 1),
  total             numeric(10,2) not null,
  deposit_amount    numeric(10,2) not null,
  id_photo_path     text not null,            -- private license-photos bucket, licenses/stays/…
  payment_proof_path text,                    -- payment-proofs bucket, proofs/stays/…
  notes             text,
  status            text not null default 'awaiting_deposit'
                    check (status in ('awaiting_deposit', 'confirmed', 'checked_in', 'checked_out', 'cancelled')),
  payment_status    text not null default 'for_verification'
                    check (payment_status in ('for_verification', 'deposit_paid', 'paid', 'refunded')),
  terms_agreed_at   timestamptz,
  terms_snapshot    text,
  cancel_reason     text,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (check_out > check_in),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index if not exists stay_bookings_room_dates on public.stay_bookings (room_id, check_in, check_out);
create index if not exists stay_bookings_customer on public.stay_bookings (customer_user_id);

create or replace function public.stay_bookings_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then new.cancelled_at := now(); end if;
  return new;
end $$;
drop trigger if exists stay_bookings_touch on public.stay_bookings;
create trigger stay_bookings_touch before update on public.stay_bookings for each row execute function public.stay_bookings_touch();

-- new properties belong to "Padaya Stays" unless set
create or replace function public.stay_default_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is null then new.business_id := (select id from public.businesses where slug = 'padaya-stays'); end if;
  return new;
end $$;
drop trigger if exists stay_properties_business on public.stay_properties;
create trigger stay_properties_business before insert on public.stay_properties for each row execute function public.stay_default_business();

-- ---------------------------------------------------------------- access
alter table public.stay_settings   enable row level security;
alter table public.stay_properties enable row level security;
alter table public.stay_rooms      enable row level security;
alter table public.stay_bookings   enable row level security;

drop policy if exists "stay settings read" on public.stay_settings;
create policy "stay settings read" on public.stay_settings for select using (true);
drop policy if exists "stay settings staff" on public.stay_settings;
create policy "stay settings staff" on public.stay_settings for update to authenticated using (public.has_perm('rentals')) with check (public.has_perm('rentals'));

drop policy if exists "stay properties read" on public.stay_properties;
create policy "stay properties read" on public.stay_properties for select using (is_active or public.has_perm('rentals'));
drop policy if exists "stay properties staff" on public.stay_properties;
create policy "stay properties staff" on public.stay_properties for all to authenticated using (public.has_perm('rentals')) with check (public.has_perm('rentals'));

drop policy if exists "stay rooms read" on public.stay_rooms;
create policy "stay rooms read" on public.stay_rooms for select
  using ((is_active and exists (select 1 from public.stay_properties p where p.id = property_id and p.is_active)) or public.has_perm('rentals'));
drop policy if exists "stay rooms staff" on public.stay_rooms;
create policy "stay rooms staff" on public.stay_rooms for all to authenticated using (public.has_perm('rentals')) with check (public.has_perm('rentals'));

drop policy if exists "stay bookings staff read" on public.stay_bookings;
create policy "stay bookings staff read" on public.stay_bookings for select to authenticated using (public.has_perm('rentals') or customer_user_id = auth.uid());
drop policy if exists "stay bookings staff update" on public.stay_bookings;
create policy "stay bookings staff update" on public.stay_bookings for update to authenticated using (public.has_perm('rentals')) with check (public.has_perm('rentals'));
-- no direct inserts: customers book through book_stay()

-- stay photos: public menu-photos bucket under stays/, uploaded by rentals staff
drop policy if exists "stay photos staff insert" on storage.objects;
create policy "stay photos staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and (storage.foldername(name))[1] = 'stays' and public.has_perm('rentals'));
drop policy if exists "stay photos staff delete" on storage.objects;
create policy "stay photos staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and (storage.foldername(name))[1] = 'stays' and public.has_perm('rentals'));

-- ---------------------------------------------------------------- availability & price
-- rooms of this type already taken on each night of [from, to)
create or replace function public.stay_room_nights(p_room uuid, p_from date, p_to date)
returns table (night date, taken int)
language sql stable security definer set search_path = public as $$
  select d::date, (select count(*)::int from public.stay_bookings b
                   where b.room_id = p_room and b.status <> 'cancelled' and b.check_in <= d::date and b.check_out > d::date)
  from generate_series(p_from, p_to - 1, interval '1 day') d;
$$;
grant execute on function public.stay_room_nights(uuid, date, date) to anon, authenticated;

-- nights in [from, to) on which every room of this type is booked (for the calendar)
create or replace function public.stay_full_nights(p_room uuid, p_from date, p_to date) returns setof date
language sql stable security definer set search_path = public as $$
  select n.night from public.stay_room_nights(p_room, p_from, p_to) n
  where n.taken >= (select units from public.stay_rooms where id = p_room);
$$;
grant execute on function public.stay_full_nights(uuid, date, date) to anon, authenticated;

create or replace function public.stay_price(p_room uuid, p_in date, p_out date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when extract(isodow from d) in (5, 6) then coalesce(r.weekend_rate, r.nightly_rate) else r.nightly_rate end), 0)
  from public.stay_rooms r, generate_series(p_in, p_out - 1, interval '1 day') d
  where r.id = p_room;
$$;
grant execute on function public.stay_price(uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------- booking
create or replace function public.book_stay(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  ss       public.stay_settings;
  r        public.stay_rooms;
  pr       public.stay_properties;
  v_in     date;
  v_out    date;
  v_nights int;
  v_guests int;
  v_name   text := trim(coalesce(p->>'customer_name', ''));
  v_phone  text := regexp_replace(coalesce(p->>'customer_phone', ''), '[\s-]', '', 'g');
  v_email  text := nullif(trim(coalesce(p->>'customer_email', '')), '');
  v_id     text := p->>'id_photo_path';
  v_proof  text := p->>'payment_proof_path';
  v_total  numeric;
  v_dep    numeric;
  v_today  date := (now() at time zone 'Asia/Manila')::date;
  b        public.stay_bookings;
begin
  if coalesce((select require_account from public.store_settings where id = 1), false) and auth.uid() is null then
    raise exception 'SIGN_IN: Please sign in or create an account to book a stay.';
  end if;
  select * into ss from public.stay_settings where id = 1;
  if not ss.bookings_enabled or length(trim(coalesce(ss.terms, ''))) = 0 then
    raise exception 'CLOSED: Stay bookings are not open yet.';
  end if;
  select * into r from public.stay_rooms where id = (p->>'room_id')::uuid and is_active;
  if not found then raise exception 'INVALID: Please choose a room.'; end if;
  select * into pr from public.stay_properties where id = r.property_id and is_active;
  if not found then raise exception 'INVALID: Please choose a room.'; end if;

  begin
    v_in := (p->>'check_in')::date;
    v_out := (p->>'check_out')::date;
  exception when others then raise exception 'INVALID: Please choose your check-in and check-out dates.';
  end;
  if v_in is null or v_out is null then raise exception 'INVALID: Please choose your check-in and check-out dates.'; end if;
  if v_in < v_today then raise exception 'INVALID: Check-in can''t be in the past.'; end if;
  if v_in > v_today + 365 then raise exception 'INVALID: Bookings open up to a year ahead.'; end if;
  if v_out <= v_in then raise exception 'INVALID: Check-out must be after check-in.'; end if;
  v_nights := v_out - v_in;
  if v_nights < r.min_nights then raise exception 'INVALID: % needs at least % night%.', r.name, r.min_nights, case when r.min_nights > 1 then 's' else '' end; end if;
  if v_nights > ss.max_nights then raise exception 'INVALID: Stays can be up to % nights.', ss.max_nights; end if;

  begin v_guests := coalesce((p->>'guests')::int, 0);
  exception when others then raise exception 'INVALID: Please choose the number of guests.'; end;
  if v_guests < 1 or v_guests > r.max_guests then raise exception 'INVALID: % fits up to % guest%.', r.name, r.max_guests, case when r.max_guests > 1 then 's' else '' end; end if;

  if length(v_name) < 2 then raise exception 'INVALID: Please enter your name.'; end if;
  if v_phone ~ '^\+?63' then v_phone := '0' || regexp_replace(v_phone, '^\+?63', ''); end if;
  if v_phone !~ '^09\d{9}$' then raise exception 'INVALID: Use the format 09XXXXXXXXX for your mobile number.'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then raise exception 'INVALID: Please check your email address.'; end if;
  if v_id is null or v_id !~ '^licenses/stays/[A-Za-z0-9._\-/]+$' then raise exception 'INVALID: Please add a photo of a valid ID.'; end if;
  if coalesce((p->>'terms_agreed')::boolean, false) is not true then raise exception 'INVALID: Please read and agree to the house rules and cancellation policy.'; end if;
  if v_proof is null or v_proof !~ '^proofs/stays/[A-Za-z0-9._\-/]+$' then raise exception 'INVALID: Please upload a screenshot of your GCash deposit.'; end if;

  v_total := round(public.stay_price(r.id, v_in, v_out), 2);
  v_dep := least(v_total, greatest(round(v_total * ss.deposit_percent / 100.0), 1));

  -- one booking at a time per room type, then make sure a room is free every night
  perform 1 from public.stay_rooms where id = r.id for update;
  if exists (select 1 from public.stay_room_nights(r.id, v_in, v_out) n where n.taken >= r.units) then
    raise exception 'UNAVAILABLE: Sorry, % is fully booked on some of those nights. Please choose other dates.', r.name;
  end if;

  insert into public.stay_bookings (room_id, room_name, property_name, customer_user_id, customer_name, customer_phone, customer_email,
    check_in, check_out, nights, guests, total, deposit_amount, id_photo_path, payment_proof_path, notes, terms_agreed_at, terms_snapshot)
  values (r.id, r.name, pr.name, auth.uid(), v_name, v_phone, v_email, v_in, v_out, v_nights, v_guests, v_total, v_dep, v_id, v_proof,
    nullif(left(trim(coalesce(p->>'notes', '')), 500), ''), now(), ss.terms)
  returning * into b;
  return jsonb_build_object('token', b.public_token, 'booking_number', b.booking_number, 'nights', b.nights, 'total', b.total, 'deposit', b.deposit_amount);
end $$;
revoke all on function public.book_stay(jsonb) from public;
grant execute on function public.book_stay(jsonb) to anon, authenticated;

create or replace function public.get_stay_booking(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'booking_number', b.booking_number, 'status', b.status, 'payment_status', b.payment_status,
    'room_name', b.room_name, 'property_name', b.property_name, 'customer_name', b.customer_name,
    'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights, 'guests', b.guests,
    'total', b.total, 'deposit_amount', b.deposit_amount, 'cancel_reason', b.cancel_reason, 'created_at', b.created_at,
    'check_in_time', p.check_in_time, 'check_out_time', p.check_out_time, 'location_text', p.location_text, 'map_url', p.map_url,
    'free_cancel_days', (select free_cancel_days from public.stay_settings where id = 1))
  from public.stay_bookings b
  join public.stay_rooms r on r.id = b.room_id
  join public.stay_properties p on p.id = r.property_id
  where b.public_token = p_token;
$$;
grant execute on function public.get_stay_booking(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- customer inbox
create or replace function public.stay_customer_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_body text;
begin
  if new.customer_user_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_title := 'Stay ' || new.booking_number || ' received';
    v_body  := 'We''re checking your deposit. You''ll get a message once your stay is confirmed.';
  elsif new.status is distinct from old.status then
    v_title := 'Stay ' || new.booking_number || ' · ' || case new.status
      when 'confirmed' then 'confirmed' when 'checked_in' then 'welcome!' when 'checked_out' then 'thank you'
      when 'cancelled' then 'cancelled' else new.status end;
    v_body := case new.status
      when 'confirmed'   then new.room_name || ', ' || to_char(new.check_in, 'Mon DD') || ' – ' || to_char(new.check_out, 'Mon DD') || '. See you soon!'
      when 'checked_in'  then 'Enjoy your stay at ' || new.property_name || '.'
      when 'checked_out' then 'Thanks for staying with us. Safe travels!'
      when 'cancelled'   then 'Sorry — this stay was cancelled. Message us if you have questions.'
      else null end;
  elsif new.payment_status is distinct from old.payment_status and new.payment_status = 'refunded' then
    v_title := 'Stay ' || new.booking_number || ' · deposit refunded';
    v_body  := 'Your deposit has been sent back.';
  else
    return new;
  end if;
  insert into public.customer_messages (user_id, title, body, link) values (new.customer_user_id, v_title, v_body, '/stays/booking/' || new.public_token);
  return new;
end $$;
drop trigger if exists stay_bookings_customer_message on public.stay_bookings;
create trigger stay_bookings_customer_message after insert or update of status, payment_status on public.stay_bookings
  for each row execute function public.stay_customer_message();

do $$ begin
  alter publication supabase_realtime add table public.stay_bookings;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- sample (hidden until you fill it in)
do $$
declare v_prop uuid;
begin
  if not exists (select 1 from public.stay_properties) then
    insert into public.stay_properties (name, description, location_text, amenities, house_rules, is_active)
    values ('Sample property — edit me', 'Replace with your place: photos, description and location.', 'San Agustin, Romblon',
            array['Wi-Fi', 'Air-con', 'Hot shower', 'Parking'], 'No smoking indoors. Quiet hours 10 PM – 7 AM.', false)
    returning id into v_prop;
    insert into public.stay_rooms (property_id, name, description, nightly_rate, weekend_rate, max_guests, units, min_nights, amenities)
    values (v_prop, 'Sample room — edit me', 'Queen bed, private bathroom.', 1800, 2200, 2, 1, 1, array['Queen bed', 'Private bathroom']);
  end if;
end $$;
