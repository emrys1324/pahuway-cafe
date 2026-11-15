-- Padaya R2: several food stores, each with its own menu, hours and open switch.
-- Pahuway Cafe keeps using store_settings (its Settings page) for hours; other stores keep theirs on businesses.
-- A cart (and an order) is from one store. Orders remember their store; staff see it on the Orders board.

alter table public.businesses
  add column if not exists tagline      text check (tagline is null or length(tagline) <= 80),
  add column if not exists emoji        text not null default '🍽️',
  add column if not exists logo_url     text,
  add column if not exists sort_order   int not null default 0,
  add column if not exists is_open      boolean not null default true,   -- staff "open / closed now" switch
  add column if not exists open_time    time not null default '07:00',
  add column if not exists close_time   time not null default '21:00',
  add column if not exists prep_minutes int not null default 20 check (prep_minutes between 5 and 180);

-- staff who manage the menu can see and edit stores (hidden ones too)
drop policy if exists "businesses public read" on public.businesses;
create policy "businesses public read" on public.businesses for select using (is_active or public.is_admin() or public.has_perm('menu'));
drop policy if exists "businesses menu staff write" on public.businesses;
create policy "businesses menu staff write" on public.businesses for update to authenticated using (public.has_perm('menu')) with check (public.has_perm('menu'));
drop policy if exists "businesses menu staff insert" on public.businesses;
create policy "businesses menu staff insert" on public.businesses for insert to authenticated with check (public.has_perm('menu') and kind = 'food');

-- menu categories belong to a store too
alter table public.menu_categories add column if not exists business_id uuid references public.businesses (id);
update public.menu_categories set business_id = (select id from public.businesses where slug = 'pahuway-cafe') where business_id is null;
drop trigger if exists menu_categories_default_business on public.menu_categories;
create trigger menu_categories_default_business before insert on public.menu_categories for each row execute function public.default_business();

-- orders remember their store
alter table public.orders add column if not exists business_id uuid references public.businesses (id);
update public.orders set business_id = (select id from public.businesses where slug = 'pahuway-cafe') where business_id is null;
create index if not exists orders_business on public.orders (business_id, created_at desc);
create or replace function public.order_default_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is null then
    new.business_id := coalesce(nullif(current_setting('padaya.order_business', true), '')::uuid,
                                (select id from public.businesses where slug = 'pahuway-cafe'));
  end if;
  return new;
end $$;
drop trigger if exists orders_default_business on public.orders;
create trigger orders_default_business before insert on public.orders for each row execute function public.order_default_business();

-- is a store taking orders right now? (Pahuway: its Settings hours; others: their own)
create or replace function public.business_is_open_now(p_business uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b public.businesses; tz text;
begin
  select * into b from public.businesses where id = p_business;
  if not found or not b.is_active or b.kind <> 'food' then return false; end if;
  if b.slug = 'pahuway-cafe' then
    select coalesce(timezone, 'Asia/Manila') into tz from public.store_settings where id = 1;
    return (select is_open from public.store_settings where id = 1)
       and public.within_hours((now() at time zone tz)::time, (select open_time from public.store_settings where id = 1), (select close_time from public.store_settings where id = 1));
  end if;
  select coalesce(timezone, 'Asia/Manila') into tz from public.store_settings where id = 1;
  return b.is_open and public.within_hours((now() at time zone tz)::time, b.open_time, b.close_time);
end $$;
grant execute on function public.business_is_open_now(uuid) to anon, authenticated;

-- place_order checks "is the store open?" with store_is_open_now(); during an order for another store it
-- answers for that store.
create or replace function public.store_is_open_now() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s public.store_settings; v_b text := nullif(current_setting('padaya.order_business', true), '');
begin
  if v_b is not null and v_b::uuid is distinct from (select id from public.businesses where slug = 'pahuway-cafe') then
    return public.business_is_open_now(v_b::uuid);
  end if;
  select * into s from public.store_settings where id = 1;
  if not found or not s.is_open then return false; end if;
  return public.within_hours((now() at time zone s.timezone)::time, s.open_time, s.close_time);
end $$;

-- the existing order logic becomes place_order_items (only callable through place_order below)
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'place_order_items') then
    alter function public.place_order(jsonb, jsonb) rename to place_order_items;
  end if;
end $$;
revoke all on function public.place_order_items(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.place_order(p_order jsonb, p_items jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_biz uuid[];
  b     public.businesses;
  r     jsonb;
begin
  if jsonb_typeof(p_items) = 'array' then
    select coalesce(array_agg((x ->> 'menu_item_id')::uuid), '{}') into v_ids from jsonb_array_elements(p_items) x;
  end if;
  select coalesce(array_agg(distinct business_id), '{}') into v_biz from public.menu_items where id = any (v_ids);
  if array_length(v_biz, 1) > 1 then
    raise exception 'INVALID: Your cart has items from more than one store. Please order from one store at a time.';
  end if;
  if array_length(v_biz, 1) = 1 then
    select * into b from public.businesses where id = v_biz[1];
    if not b.is_active then
      raise exception 'ITEM_UNAVAILABLE: % isn''t taking orders on Padaya right now.', b.name;
    end if;
    if b.slug <> 'pahuway-cafe' then
      if nullif(p_order ->> 'scheduled_for', '') is not null then
        raise exception 'INVALID: % takes orders for as soon as possible only.', b.name;
      end if;
      if not public.business_is_open_now(b.id) then
        raise exception 'STORE_CLOSED: % is closed right now. Ordering opens at %.', b.name, to_char(b.open_time, 'FMHH12:MI AM');
      end if;
    end if;
    perform set_config('padaya.order_business', b.id::text, true);
  end if;
  r := public.place_order_items(p_order, p_items);
  perform set_config('padaya.order_business', '', true);
  return r || jsonb_build_object('business', coalesce(b.slug, 'pahuway-cafe'));
end $$;
revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;

-- your second brand from the design, ready to edit: hidden until you check the menu and switch it on
do $$
declare v_b uuid; v_c uuid;
begin
  if exists (select 1 from public.businesses where slug = 'kusina-sa-hiraya') then return; end if;
  insert into public.businesses (slug, name, kind, is_active, tagline, emoji, town, prep_minutes, open_time, close_time, sort_order)
  values ('kusina-sa-hiraya', 'Kusina sa Hiraya', 'food', false, 'Ramen, dimsum & more', '🍜', 'San Agustin', 35, '10:00', '21:00', 10)
  returning id into v_b;
  insert into public.menu_categories (name, sort_order, business_id) values ('Mains', 1, v_b) returning id into v_c;
  insert into public.menu_items (category_id, business_id, name, description, price, sort_order) values
    (v_c, v_b, 'Shoyu Ramen', 'Soy broth, chashu, egg, nori', 250, 1);
  insert into public.menu_categories (name, sort_order, business_id) values ('Sides', 2, v_b) returning id into v_c;
  insert into public.menu_items (category_id, business_id, name, description, price, sort_order) values
    (v_c, v_b, 'Pork Gyoza (6 pcs)', 'Pan-fried, with dipping sauce', 150, 1),
    (v_c, v_b, 'Dimsum Platter', 'Siomai, hakaw & buns', 180, 2);
  insert into public.menu_categories (name, sort_order, business_id) values ('Drinks', 3, v_b) returning id into v_c;
  insert into public.menu_items (category_id, business_id, name, description, price, sort_order) values
    (v_c, v_b, 'Tea Refresher', 'Lemon, passion fruit or lychee', 90, 1);
  insert into public.menu_categories (name, sort_order, business_id) values ('Dessert', 4, v_b) returning id into v_c;
  insert into public.menu_items (category_id, business_id, name, description, price, sort_order) values
    (v_c, v_b, 'Buko Pie (slice)', 'Young coconut custard pie', 60, 1),
    (v_c, v_b, 'Buko Pie (whole)', 'Perfect pasalubong', 350, 2);
end $$;

update public.businesses set emoji = '☕' where slug = 'pahuway-cafe' and emoji = '🍽️';

-- a menu item always belongs to the store of its category
create or replace function public.menu_item_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.business_id := coalesce((select business_id from public.menu_categories where id = new.category_id), new.business_id,
                              (select id from public.businesses where slug = 'pahuway-cafe'));
  return new;
end $$;
drop trigger if exists menu_items_default_business on public.menu_items;
drop trigger if exists menu_items_business on public.menu_items;
create trigger menu_items_business before insert or update of category_id on public.menu_items for each row execute function public.menu_item_business();

-- the order page shows which store the order is from
create or replace function public.get_order_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'store_name', (select name from public.businesses where id = o.business_id), 'store_slug', (select slug from public.businesses where id = o.business_id), 'status', o.status, 'order_type', o.order_type,
    'customer_name', o.customer_name, 'scheduled_for', o.scheduled_for,
    'zone_name', o.zone_name, 'street', o.street, 'landmark', o.landmark,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'cancel_reason', o.cancel_reason,
    'checkout_url', case when o.payment_status::text = 'awaiting_payment' then o.checkout_url end,
    'payment_expires_at', o.payment_expires_at, 'paid_at', o.paid_at, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'accepted_at', o.accepted_at, 'ready_at', o.ready_at, 'picked_up_at', o.picked_up_at,
    'completed_at', o.completed_at, 'cancelled_at', o.cancelled_at,
    'rider_name', (select split_part(r.name, ' ', 1) from public.riders r where r.id = o.rider_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'item_name', i.item_name, 'quantity', i.quantity, 'options', i.options,
                'notes', i.notes, 'unit_price', i.unit_price, 'line_total', i.line_total) order by i.id)
              from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o where o.public_token = p_token;
$$;
