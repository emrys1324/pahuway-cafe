-- Padaya 2.0, Phase 2: car rental on the same booking engine as the scooters.
-- Vehicles get a type (scooter / car) and car details; cars can be booked self-drive (license photo)
-- or with a driver (driver fee per day, no license needed).

alter table public.scooters
  add column if not exists vehicle_type text not null default 'scooter' check (vehicle_type in ('scooter', 'car')),
  add column if not exists seats        int check (seats is null or seats between 1 and 30),
  add column if not exists transmission text check (transmission is null or transmission in ('automatic', 'manual')),
  add column if not exists fuel         text check (fuel is null or fuel in ('gasoline', 'diesel', 'electric', 'hybrid')),
  add column if not exists driver_fee   numeric(10,2) check (driver_fee is null or driver_fee >= 0);  -- null = self-drive only

alter table public.rental_bookings
  add column if not exists with_driver boolean not null default false,
  add column if not exists driver_fee  numeric(10,2) not null default 0;
alter table public.rental_bookings alter column license_path drop not null;
alter table public.rental_bookings drop constraint if exists rental_license_unless_driver;
alter table public.rental_bookings add constraint rental_license_unless_driver check (with_driver or license_path is not null);

create or replace function public.book_scooter(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  rs        public.rental_settings;
  sc        public.scooters;
  v_pickup  timestamptz;
  v_return  timestamptz;
  v_days    int;
  v_phone   text := regexp_replace(coalesce(p->>'customer_phone', ''), '[\s-]', '', 'g');
  v_name    text := trim(coalesce(p->>'customer_name', ''));
  v_email   text := nullif(trim(coalesce(p->>'customer_email', '')), '');
  v_helmets int;
  v_license text := p->>'license_path';
  v_ref     text := nullif(regexp_replace(coalesce(p->>'gcash_reference', ''), '\s', '', 'g'), '');
  v_proof   text := p->>'payment_proof_path';
  v_method  text := coalesce(nullif(p->>'payment_method', ''), 'gcash');
  v_excess  int;
  v_excess_fee numeric;
  v_security numeric;
  v_upfront boolean := coalesce((p->>'security_upfront')::boolean, false);
  v_pay_now numeric;
  v_total   numeric;
  v_deposit numeric;
  b         public.rental_bookings;
  v_driver  boolean := coalesce((p->>'with_driver')::boolean, false);
  v_driver_fee numeric := 0;
  v_is_car  boolean;
begin
  if coalesce((select require_account from public.store_settings where id = 1), false) and auth.uid() is null then
    raise exception 'SIGN_IN: Please sign in or create an account to book.';
  end if;
  select * into rs from public.rental_settings where id = 1;
  if not rs.bookings_enabled or length(trim(coalesce(rs.terms, ''))) = 0 then
    raise exception 'CLOSED: Scooter bookings are not open yet.';
  end if;

  select * into sc from public.scooters where id = (p->>'scooter_id')::uuid and is_active;
  if not found then raise exception 'INVALID: Please choose a vehicle.'; end if;
  v_is_car := sc.vehicle_type = 'car';
  if v_driver and (not v_is_car or sc.driver_fee is null) then
    raise exception 'INVALID: % is self-drive only.', sc.name;
  end if;

  begin
    v_pickup := (p->>'pickup_at')::timestamp at time zone 'Asia/Manila';
    v_return := (p->>'return_at')::timestamp at time zone 'Asia/Manila';
  exception when others then raise exception 'INVALID: Please choose your pickup and return times.';
  end;
  if v_pickup is null or v_return is null then raise exception 'INVALID: Please choose your pickup and return times.'; end if;
  if extract(minute from v_pickup at time zone 'Asia/Manila') not in (0, 30) or extract(second from v_pickup) <> 0
     or extract(minute from v_return at time zone 'Asia/Manila') not in (0, 30) or extract(second from v_return) <> 0 then
    raise exception 'INVALID: Times must be on the hour or half hour.';
  end if;
  if v_pickup < now() - interval '15 minutes' then raise exception 'INVALID: The pickup time has passed. Please choose a later time.'; end if;
  if v_pickup > now() + interval '180 days' then raise exception 'INVALID: Bookings open up to 6 months ahead.'; end if;
  if v_return < v_pickup + interval '1 hour' then raise exception 'INVALID: The return time must be at least 1 hour after pickup.'; end if;
  if (v_pickup at time zone 'Asia/Manila')::time not between rs.open_time and rs.close_time
     or (v_return at time zone 'Asia/Manila')::time not between rs.open_time and rs.close_time then
    raise exception 'INVALID: Pickup and return are from % to % only. For other times, please message us to arrange.',
      to_char(rs.open_time, 'FMHH12:MI AM'), to_char(rs.close_time, 'FMHH12:MI AM');
  end if;
  select q.days, q.excess_hours into v_days, v_excess from public.rental_quote(v_pickup, v_return, rs.max_excess_hours) q;
  if v_days > rs.max_days then raise exception 'INVALID: Rentals can be up to % days.', rs.max_days; end if;

  if length(v_name) < 2 then raise exception 'INVALID: Please enter your name.'; end if;
  if v_phone ~ '^\+?63' then v_phone := '0' || regexp_replace(v_phone, '^\+?63', ''); end if;
  if v_phone !~ '^09\d{9}$' then raise exception 'INVALID: Use the format 09XXXXXXXXX for your mobile number.'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then raise exception 'INVALID: Please check your email address.'; end if;

  begin v_helmets := case when v_is_car then 0 else coalesce((p->>'helmets')::int, 1) end;
  exception when others then raise exception 'INVALID: Choose 0, 1 or 2 helmets.'; end;
  if v_helmets not between 0 and 2 then raise exception 'INVALID: Choose 0, 1 or 2 helmets.'; end if;

  if v_driver then
    v_license := null;  -- our driver drives: no license needed
  elsif v_license is null or v_license !~ '^licenses/[A-Za-z0-9._\-/]+$' then
    raise exception 'INVALID: Please add a photo of your driver''s license.';
  end if;
  if coalesce((p->>'terms_agreed')::boolean, false) is not true then
    raise exception 'INVALID: Please read and agree to the terms and conditions.';
  end if;
  if v_method not in ('gcash', 'online') then raise exception 'INVALID: Please choose how to pay the deposit.'; end if;
  if v_method = 'online' then
    if not rs.online_enabled then raise exception 'INVALID: Online payment is not available right now. Please pay with GCash.'; end if;
    v_ref := null; v_proof := null;
  else
    v_ref := left(v_ref, 40);  -- optional: the receipt screenshot is what staff check
    if v_proof is null or v_proof !~ '^proofs/rentals/[A-Za-z0-9._\-/]+$' then
      raise exception 'INVALID: Please upload a screenshot of your GCash payment.';
    end if;
  end if;

  v_excess_fee := round(v_excess * rs.excess_hour_rate, 2);
  -- with driver: the driver's fee per started day (extra hours count as one more day)
  v_driver_fee := case when v_driver then round(sc.driver_fee * (v_days + case when v_excess > 0 then 1 else 0 end), 2) else 0 end;
  v_total   := round(v_days * sc.daily_rate + v_excess_fee + v_driver_fee, 2);
  v_deposit := least(v_total, greatest(round(v_total * rs.deposit_percent / 100.0), 1));
  v_security := coalesce(sc.security_deposit, rs.security_deposit, 0);
  v_upfront := v_upfront and v_security > 0;
  v_pay_now := v_deposit + case when v_upfront then v_security else 0 end;

  perform public.expire_unpaid_bookings();  -- free expired online holds first
  -- one booking at a time per model: lock it, then make sure a unit is free for the whole stay
  -- (overdue units count as taken until returned)
  perform 1 from public.scooters where id = sc.id for update;
  if public.scooter_peak_use(sc.id, v_pickup, v_return + make_interval(mins => rs.turnaround_minutes)) >= sc.units then
    if exists (select 1 from public.rental_bookings o where o.scooter_id = sc.id and o.status = 'picked_up' and o.blocked_until <= now()) then
      raise exception 'UNAVAILABLE: Sorry, % is not back yet. Please choose another vehicle or try again later.', sc.name;
    end if;
    raise exception 'UNAVAILABLE: Sorry, % is already booked during those times. Please pick other times or another vehicle.', sc.name;
  end if;
  begin
    insert into public.rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, customer_email,
      start_date, end_date, pickup_at, return_at, blocked_until, days, daily_rate, helmets, delivery, delivery_address, delivery_fee,
      total, deposit_amount, security_deposit, license_path, notes,
      payment_method, payment_status, gcash_reference, payment_proof_path, payment_expires_at, terms_agreed_at, terms_snapshot,
      excess_hours, excess_fee, security_upfront, pay_now, customer_user_id, with_driver, driver_fee)
    values (sc.id, sc.name, v_name, v_phone, v_email,
      (v_pickup at time zone 'Asia/Manila')::date, (v_return at time zone 'Asia/Manila')::date,
      v_pickup, v_return, v_return + make_interval(mins => rs.turnaround_minutes),
      v_days, sc.daily_rate, v_helmets, false, null, 0,
      v_total, v_deposit, v_security, v_license, nullif(left(trim(coalesce(p->>'notes', '')), 500), ''),
      v_method, case when v_method = 'online' then 'awaiting_payment' else 'for_verification' end, v_ref, v_proof,
      case when v_method = 'online' then now() + interval '30 minutes' end, now(), rs.terms,
      v_excess, v_excess_fee, v_upfront, v_pay_now, auth.uid(), v_driver, v_driver_fee)
    returning * into b;
  exception when exclusion_violation then
    raise exception 'UNAVAILABLE: Sorry, % is already booked during those times. Please pick other times or another vehicle.', sc.name;
  end;
  return jsonb_build_object('token', b.public_token, 'booking_number', b.booking_number, 'total', b.total, 'deposit', b.deposit_amount, 'days', b.days, 'payment_method', b.payment_method,
    'excess_hours', b.excess_hours, 'excess_fee', b.excess_fee, 'security_deposit', b.security_deposit, 'security_upfront', b.security_upfront, 'pay_now', b.pay_now, 'with_driver', b.with_driver, 'driver_fee', b.driver_fee);
end $$;

-- the customer's booking page also shows 'with driver' and the driver fee
create or replace function public.get_booking_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'booking_number', b.booking_number, 'status',
      case when b.status = 'awaiting_deposit' and coalesce(b.payment_expires_at < now(), false) then 'cancelled' else b.status end,
    'payment_status', b.payment_status, 'payment_method', b.payment_method, 'gcash_reference', b.gcash_reference,
    'scooter_name', b.scooter_name, 'customer_name', b.customer_name,
    'start_date', b.start_date, 'end_date', b.end_date, 'pickup_at', b.pickup_at, 'return_at', b.return_at,
    'days', b.days, 'daily_rate', b.daily_rate, 'helmets', b.helmets,
    'delivery', b.delivery, 'delivery_address', b.delivery_address, 'delivery_fee', b.delivery_fee,
    'total', b.total, 'deposit_amount', b.deposit_amount, 'security_deposit', b.security_deposit,
    'excess_hours', b.excess_hours, 'excess_fee', b.excess_fee, 'security_upfront', b.security_upfront, 'pay_now', b.pay_now,
    'checkout_url', b.checkout_url, 'payment_expires_at', b.payment_expires_at, 'cancel_reason', b.cancel_reason,
    'created_at', b.created_at, 'with_driver', b.with_driver, 'driver_fee', b.driver_fee,
    'vehicle_type', (select v.vehicle_type from public.scooters v where v.id = b.scooter_id))
  from public.rental_bookings b where b.public_token = p_token;
$$;

-- a sample car to fill in (hidden until you switch it on in Rentals → Vehicles)
insert into public.scooters (name, description, daily_rate, units, is_active, vehicle_type, seats, transmission, fuel, driver_fee, sort_order)
select 'Sample car — edit me', 'Replace with your car: photos, rate, seats and rules.', 2500, 1, false, 'car', 5, 'automatic', 'gasoline', 1000, 100
where not exists (select 1 from public.scooters where vehicle_type = 'car');
