-- Customers need an account to order or book (switch in Settings, on by default); bookings are linked
-- to the customer's account so they can see them under My account. Google sign-in is configured in
-- Supabase Auth (no database change needed for it).

alter table public.store_settings add column if not exists require_account boolean not null default true;

alter table public.rental_bookings add column if not exists customer_user_id uuid references public.users (id) on delete set null;
create index if not exists rental_bookings_customer on public.rental_bookings (customer_user_id);
drop policy if exists "bookings own read" on public.rental_bookings;
create policy "bookings own read" on public.rental_bookings for select to authenticated using (customer_user_id = auth.uid());

create or replace function public.place_order(p_order jsonb, p_items jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s              public.store_settings;
  v_name         text := trim(coalesce(p_order ->> 'customer_name', ''));
  v_phone        text := regexp_replace(coalesce(p_order ->> 'customer_phone', ''), '[\s\-()]', '', 'g');
  v_type         public.order_type;
  v_pay          public.payment_method;
  v_sched        timestamptz;
  v_zone         public.delivery_zones;
  v_street       text := nullif(trim(coalesce(p_order ->> 'street', '')), '');
  v_landmark     text := nullif(trim(coalesce(p_order ->> 'landmark', '')), '');
  v_rider_notes  text := nullif(trim(coalesce(p_order ->> 'rider_notes', '')), '');
  v_ref          text := nullif(trim(coalesce(p_order ->> 'gcash_reference', '')), '');
  v_proof        text := nullif(trim(coalesce(p_order ->> 'payment_proof_path', '')), '');
  v_lat          numeric(9,6);
  v_lng          numeric(9,6);
  v_line         jsonb;
  v_item         public.menu_items;
  v_qty          int;
  v_notes        text;
  v_opt_ids      uuid[];
  v_opts         jsonb;
  v_opts_total   numeric(10,2);
  v_subtotal     numeric(10,2) := 0;
  v_fee          numeric(10,2) := 0;
  v_lines        jsonb := '[]'::jsonb;
  v_grp          record;
  v_count        int;
  v_order        public.orders;
begin
  if coalesce((select require_account from public.store_settings where id = 1), false) and auth.uid() is null then
    raise exception 'SIGN_IN: Please sign in or create an account to order.';
  end if;
  select * into s from public.store_settings where id = 1;

  if not public.store_is_open_now() then
    raise exception 'STORE_CLOSED: %', s.closed_message;
  end if;

  -- Customer details
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'INVALID: Please enter your name.';
  end if;
  if v_phone ~ '^\+639[0-9]{9}$' then v_phone := '0' || substr(v_phone, 4);
  elsif v_phone ~ '^639[0-9]{9}$' then v_phone := '0' || substr(v_phone, 3);
  end if;
  if v_phone !~ '^09[0-9]{9}$' then
    raise exception 'INVALID: Mobile number must look like 09XXXXXXXXX.';
  end if;

  begin
    v_type := (p_order ->> 'order_type')::public.order_type;
    v_pay  := (p_order ->> 'payment_method')::public.payment_method;
  exception when others then
    raise exception 'INVALID: Please choose an order type and payment method.';
  end;
  if v_type is null or v_pay is null then
    raise exception 'INVALID: Please choose an order type and payment method.';
  end if;

  -- Schedule (null = ASAP)
  if nullif(p_order ->> 'scheduled_for', '') is not null then
    v_sched := (p_order ->> 'scheduled_for')::timestamptz;
    if v_sched < now() + interval '10 minutes' or v_sched > now() + interval '18 hours'
       or not public.within_hours((v_sched at time zone s.timezone)::time, s.open_time, s.close_time) then
      raise exception 'INVALID: That pickup/delivery time is no longer available. Please choose another slot.';
    end if;
  end if;

  -- Items
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID: Your cart is empty.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'INVALID: Too many items in one order.';
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    select * into v_item from public.menu_items where id = (v_line ->> 'menu_item_id')::uuid;
    if not found or not v_item.is_active then
      raise exception 'ITEM_UNAVAILABLE: An item in your cart is no longer on the menu.';
    end if;
    if v_item.is_sold_out then
      raise exception 'ITEM_UNAVAILABLE: Sorry, % just sold out. Please remove it from your cart.', v_item.name;
    end if;

    v_qty := coalesce((v_line ->> 'quantity')::int, 0);
    if v_qty < 1 or v_qty > 50 then
      raise exception 'INVALID: Quantity for % must be between 1 and 50.', v_item.name;
    end if;
    v_notes := nullif(left(trim(coalesce(v_line ->> 'notes', '')), 200), '');

    select coalesce(array_agg(distinct x::uuid), '{}') into v_opt_ids
    from jsonb_array_elements_text(coalesce(v_line -> 'option_ids', '[]'::jsonb)) x;

    -- every chosen option must be active and belong to a group attached to this item
    select count(*) into v_count
    from public.item_options o
    join public.menu_item_option_groups mg on mg.group_id = o.group_id and mg.item_id = v_item.id
    where o.id = any (v_opt_ids) and o.is_active;
    if v_count <> coalesce(array_length(v_opt_ids, 1), 0) then
      raise exception 'INVALID: Some options for % are no longer available. Please re-add it.', v_item.name;
    end if;

    -- per-group rules
    for v_grp in
      select g.*, (select count(*) from public.item_options o where o.group_id = g.id and o.id = any (v_opt_ids)) as picked,
                  (select count(*) from public.item_options o where o.group_id = g.id and o.is_active) as available
      from public.option_groups g
      join public.menu_item_option_groups mg on mg.group_id = g.id and mg.item_id = v_item.id
    loop
      if v_grp.selection = 'single' and v_grp.picked > 1 then
        raise exception 'INVALID: Choose only one % for %.', lower(v_grp.name), v_item.name;
      end if;
      if v_grp.is_required and v_grp.available > 0 and v_grp.picked = 0 then
        raise exception 'INVALID: Please choose a % for %.', lower(v_grp.name), v_item.name;
      end if;
      if v_grp.selection = 'multi' and v_grp.max_select is not null and v_grp.picked > v_grp.max_select then
        raise exception 'INVALID: Choose up to % % for %.', v_grp.max_select, lower(v_grp.name), v_item.name;
      end if;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('group', g.name, 'name', o.name, 'price_delta', o.price_delta)
                              order by g.sort_order, o.sort_order), '[]'::jsonb),
           coalesce(sum(o.price_delta), 0)
      into v_opts, v_opts_total
    from public.item_options o join public.option_groups g on g.id = o.group_id
    where o.id = any (v_opt_ids);

    v_subtotal := v_subtotal + (v_item.price + v_opts_total) * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_item.id, 'item_name', v_item.name, 'base_price', v_item.price,
      'options', v_opts, 'options_total', v_opts_total, 'unit_price', v_item.price + v_opts_total,
      'quantity', v_qty, 'notes', v_notes, 'line_total', (v_item.price + v_opts_total) * v_qty);
  end loop;

  -- Delivery rules
  if v_type = 'delivery' then
    select * into v_zone from public.delivery_zones where id = nullif(p_order ->> 'zone_id', '')::uuid and is_active;
    if not found then
      raise exception 'INVALID: Please choose a barangay we deliver to.';
    end if;
    if v_street is null then
      raise exception 'INVALID: Please enter your street or landmark so our rider can find you.';
    end if;
    if v_subtotal < s.min_delivery_order then
      raise exception 'MIN_ORDER: Minimum order for delivery is ₱%.', to_char(s.min_delivery_order, 'FM999,990');
    end if;
    v_fee := v_zone.fee;
    -- Optional map pin: both or neither, and somewhere in the Philippines.
    if nullif(p_order ->> 'lat', '') is not null or nullif(p_order ->> 'lng', '') is not null then
      begin
        v_lat := (p_order ->> 'lat')::numeric;
        v_lng := (p_order ->> 'lng')::numeric;
      exception when others then
        raise exception 'INVALID: The map pin looks wrong. Please move the pin again or remove it.';
      end;
      if v_lat is null or v_lng is null or v_lat not between 4 and 22 or v_lng not between 116 and 128 then
        raise exception 'INVALID: The map pin must be in the Philippines. Please move the pin or remove it.';
      end if;
    end if;
  else
    v_street := null; v_landmark := null; v_rider_notes := null;
  end if;

  -- Payment rules
  if v_pay = 'online' then
    if not coalesce(s.online_payments_enabled, false) then
      raise exception 'INVALID: Online payment isn''t available right now. Please choose another payment method.';
    end if;
    v_ref := null; v_proof := null;
  elsif v_pay = 'gcash' then
    v_ref := left(v_ref, 40);  -- optional: staff check the screenshot
    if v_proof is null or v_proof !~ '^proofs/[A-Za-z0-9._\-/]+$' then
      raise exception 'INVALID: Please upload a screenshot of your GCash payment.';
    end if;
  else
    v_ref := null; v_proof := null;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, order_type, scheduled_for,
    zone_id, zone_name, street, landmark, rider_notes,
    subtotal, delivery_fee, total, payment_method, payment_status, gcash_reference, payment_proof_path,
    payment_expires_at, delivery_lat, delivery_lng
  ) values (
    auth.uid(), v_name, v_phone, v_type, v_sched,
    v_zone.id, v_zone.name, v_street, v_landmark, v_rider_notes,
    v_subtotal, v_fee, v_subtotal + v_fee, v_pay,
    case v_pay when 'gcash' then 'for_verification'::public.payment_status
               when 'online' then 'awaiting_payment'::public.payment_status
               else 'unpaid'::public.payment_status end,
    left(v_ref, 40), v_proof,
    case when v_pay = 'online' then now() + interval '30 minutes' end,
    v_lat, v_lng
  ) returning * into v_order;

  insert into public.order_items (order_id, menu_item_id, item_name, base_price, options, options_total, unit_price, quantity, notes, line_total)
  select v_order.id, (l ->> 'menu_item_id')::uuid, l ->> 'item_name', (l ->> 'base_price')::numeric, l -> 'options',
         (l ->> 'options_total')::numeric, (l ->> 'unit_price')::numeric, (l ->> 'quantity')::int, l ->> 'notes', (l ->> 'line_total')::numeric
  from jsonb_array_elements(v_lines) l;

  return jsonb_build_object('order_number', v_order.order_number, 'token', v_order.public_token, 'total', v_order.total,
                            'payment_method', v_order.payment_method);
end $$;

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
begin
  if coalesce((select require_account from public.store_settings where id = 1), false) and auth.uid() is null then
    raise exception 'SIGN_IN: Please sign in or create an account to book a scooter.';
  end if;
  select * into rs from public.rental_settings where id = 1;
  if not rs.bookings_enabled or length(trim(coalesce(rs.terms, ''))) = 0 then
    raise exception 'CLOSED: Scooter bookings are not open yet.';
  end if;

  select * into sc from public.scooters where id = (p->>'scooter_id')::uuid and is_active;
  if not found then raise exception 'INVALID: Please choose a scooter.'; end if;

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

  begin v_helmets := coalesce((p->>'helmets')::int, 1);
  exception when others then raise exception 'INVALID: Choose 0, 1 or 2 helmets.'; end;
  if v_helmets not between 0 and 2 then raise exception 'INVALID: Choose 0, 1 or 2 helmets.'; end if;

  if v_license is null or v_license !~ '^licenses/[A-Za-z0-9._\-/]+$' then
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
  v_total   := round(v_days * sc.daily_rate + v_excess_fee, 2);
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
      raise exception 'UNAVAILABLE: Sorry, % is not back yet. Please choose another scooter or try again later.', sc.name;
    end if;
    raise exception 'UNAVAILABLE: Sorry, % is already booked during those times. Please pick other times or another scooter.', sc.name;
  end if;
  begin
    insert into public.rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, customer_email,
      start_date, end_date, pickup_at, return_at, blocked_until, days, daily_rate, helmets, delivery, delivery_address, delivery_fee,
      total, deposit_amount, security_deposit, license_path, notes,
      payment_method, payment_status, gcash_reference, payment_proof_path, payment_expires_at, terms_agreed_at, terms_snapshot,
      excess_hours, excess_fee, security_upfront, pay_now, customer_user_id)
    values (sc.id, sc.name, v_name, v_phone, v_email,
      (v_pickup at time zone 'Asia/Manila')::date, (v_return at time zone 'Asia/Manila')::date,
      v_pickup, v_return, v_return + make_interval(mins => rs.turnaround_minutes),
      v_days, sc.daily_rate, v_helmets, false, null, 0,
      v_total, v_deposit, v_security, v_license, nullif(left(trim(coalesce(p->>'notes', '')), 500), ''),
      v_method, case when v_method = 'online' then 'awaiting_payment' else 'for_verification' end, v_ref, v_proof,
      case when v_method = 'online' then now() + interval '30 minutes' end, now(), rs.terms,
      v_excess, v_excess_fee, v_upfront, v_pay_now, auth.uid())
    returning * into b;
  exception when exclusion_violation then
    raise exception 'UNAVAILABLE: Sorry, % is already booked during those times. Please pick other times or another scooter.', sc.name;
  end;
  return jsonb_build_object('token', b.public_token, 'booking_number', b.booking_number, 'total', b.total, 'deposit', b.deposit_amount, 'days', b.days, 'payment_method', b.payment_method,
    'excess_hours', b.excess_hours, 'excess_fee', b.excess_fee, 'security_deposit', b.security_deposit, 'security_upfront', b.security_upfront, 'pay_now', b.pay_now);
end $$;
