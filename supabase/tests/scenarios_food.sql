-- Scenario tests for 0035: several food stores, one store per order, each store's hours.
\set QUIET on
\pset tuples_only on
create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL expected error containing %', needle;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if position(needle in sqlerrm) = 0 then raise exception 'FAIL expected "%" got "%"', needle, sqlerrm; end if;
  raise notice 'ok error "%"', needle;
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns text language plpgsql as $$
begin if ok then return 'ok ' || msg; end if; raise exception 'FAIL %', msg; end $$;

update store_settings set require_account = false, cash_after_orders = 0, is_open = true, open_time = '00:00', close_time = '23:59';
create temp table ids on commit preserve rows as
  select (select id from businesses where slug = 'pahuway-cafe') cafe, (select id from businesses where slug = 'kusina-sa-hiraya') kus,
         (select id from menu_items where name = 'Americano') amer, (select id from menu_items where name = 'Shoyu Ramen') ramen;
grant select on ids to anon, authenticated;
create or replace function pg_temp.o(items jsonb) returns jsonb language sql as $$
  select place_order('{"customer_name": "Ana Test", "customer_phone": "09171234567", "order_type": "pickup", "payment_method": "cash"}', items)
$$;
create or replace function pg_temp.amer() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('menu_item_id', (select amer from ids), 'quantity', 1, 'option_ids',
    (select coalesce(jsonb_agg(o.id), '[]') from item_options o join menu_item_option_groups m on m.group_id = o.group_id where m.item_id = (select amer from ids) and o.is_default)))
$$;
create or replace function pg_temp.ramen(q int default 1) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('menu_item_id', (select ramen from ids), 'quantity', q))
$$;

select pg_temp.check((select count(*) from menu_categories where business_id is null) = 0 and (select count(*) from menu_items where business_id is null) = 0, 'every category and item belongs to a store');
select pg_temp.check((select not is_active and emoji = '🍜' and tagline = 'Ramen, dimsum & more' from businesses where slug = 'kusina-sa-hiraya')
  and (select count(*) from menu_items where business_id = (select kus from ids)) = 6, 'Kusina sa Hiraya comes hidden, with its 6-item menu');
select pg_temp.check((select emoji from businesses where slug = 'pahuway-cafe') = '☕', 'Pahuway Cafe has the ☕ icon');

-- a menu item follows its category's store
insert into menu_items (category_id, name, price) values ((select id from menu_categories where business_id = (select kus from ids) and name = 'Mains'), 'Tantanmen', 270);
select pg_temp.check((select business_id from menu_items where name = 'Tantanmen') = (select kus from ids), 'a new item takes the store of its category');
update menu_items set category_id = (select id from menu_categories where business_id = (select cafe from ids) limit 1) where name = 'Tantanmen';
select pg_temp.check((select business_id from menu_items where name = 'Tantanmen') = (select cafe from ids), 'moving it to a café category moves it to the café');
delete from menu_items where name = 'Tantanmen';

-- hidden store: no orders
set role anon;
select pg_temp.expect_error($q$select pg_temp.o(pg_temp.ramen())$q$, 'isn''t taking orders');
select pg_temp.check(not business_is_open_now((select kus from ids)), 'a hidden store is not open');
reset role;
update businesses set is_active = true, open_time = '00:00', close_time = '23:59', is_open = true where slug = 'kusina-sa-hiraya';

set role anon;
create temp table k1 on commit preserve rows as select pg_temp.o(pg_temp.ramen(2)) r;
select pg_temp.check((select r->>'business' = 'kusina-sa-hiraya' and (r->>'total')::numeric = 500 from k1), 'Kusina order: 2 × ₱250 = ₱500');
create temp table c1 on commit preserve rows as select pg_temp.o(pg_temp.amer()) r;
select pg_temp.expect_error($q$select pg_temp.o(pg_temp.ramen() || pg_temp.amer())$q$, 'more than one store');
select pg_temp.expect_error($q$select place_order('{"customer_name": "Ana Test", "customer_phone": "09171234567", "order_type": "pickup", "payment_method": "cash", "scheduled_for": "2099-01-01T10:00:00Z"}', pg_temp.ramen())$q$, 'as soon as possible only');
select pg_temp.expect_error($q$select place_order_items('{}', '[]')$q$, 'permission denied');
reset role;
select pg_temp.check((select b.slug from orders o join businesses b on b.id = o.business_id where o.order_number = (select r->>'order_number' from k1)) = 'kusina-sa-hiraya'
  and (select b.slug from orders o join businesses b on b.id = o.business_id where o.order_number = (select r->>'order_number' from c1)) = 'pahuway-cafe',
  'each order is saved with its store');
select pg_temp.check((get_order_by_token((select (r->>'token')::uuid from k1))->>'store_name') = 'Kusina sa Hiraya', 'the order page knows the store');

-- each store's own hours / open switch
update businesses set is_open = false where slug = 'kusina-sa-hiraya';
set role anon;
select pg_temp.expect_error($q$select pg_temp.o(pg_temp.ramen())$q$, 'STORE_CLOSED: Kusina sa Hiraya is closed');
select pg_temp.check((pg_temp.o(pg_temp.amer())->>'business') = 'pahuway-cafe', 'the café is unaffected by another store closing');
reset role;
update businesses set is_open = true, open_time = '00:00', close_time = '00:01' where slug = 'kusina-sa-hiraya';
set role anon;
select pg_temp.expect_error($q$select pg_temp.o(pg_temp.ramen())$q$, 'STORE_CLOSED');
reset role;
update businesses set open_time = '00:00', close_time = '23:59' where slug = 'kusina-sa-hiraya';
update store_settings set is_open = false;
set role anon;
select pg_temp.check((pg_temp.o(pg_temp.ramen())->>'business') = 'kusina-sa-hiraya', 'Kusina keeps taking orders when the café is closed');
select pg_temp.expect_error($q$select pg_temp.o(pg_temp.amer())$q$, 'STORE_CLOSED');
reset role;
update store_settings set is_open = true;

-- staff: menu staff can edit stores, guests can't
set role anon;
update businesses set name = 'Hacked' where slug = 'kusina-sa-hiraya';
reset role;
select pg_temp.check((select name from businesses where slug = 'kusina-sa-hiraya') = 'Kusina sa Hiraya', 'guests can''t edit stores');
set role anon;
select pg_temp.expect_error($q$insert into businesses (slug, name, kind) values ('x-store', 'X', 'food')$q$, 'row-level security');
reset role;

select 'ALL FOOD STORE SCENARIOS PASSED';
