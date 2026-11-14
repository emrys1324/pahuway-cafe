-- Scenario tests for 0008_team_permissions.sql: per-person permissions, admins, riders, switched-off logins.
\set ON_ERROR_STOP 1
update store_settings set require_account = false, cash_after_orders = 0;  -- guest scenarios; the sign-in and cash rules are tested on their own
update store_settings set open_time = '00:00', close_time = '00:00', is_open = true;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'Wrong error. Expected "%", got "%"', needle, sqlerrm; end if;
    raise notice 'ok (rejected): %', sqlerrm; return;
  end;
  raise exception 'FAIL: statement should have been rejected: %', sql;
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns text language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; return 'ok ' || msg; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- people: admin, barista (orders + stock), kitchen lead (menu + open_close), bookkeeper (sales only), customer, rider
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'admin@t.test'),
  ('f0000000-0000-0000-0000-000000000002', 'barista@t.test'),
  ('f0000000-0000-0000-0000-000000000003', 'lead@t.test'),
  ('f0000000-0000-0000-0000-000000000004', 'books@t.test'),
  ('f0000000-0000-0000-0000-000000000005', 'customer@t.test'),
  ('f0000000-0000-0000-0000-000000000006', 'rider@t.test');
update users set role = 'admin' where id = 'f0000000-0000-0000-0000-000000000001';
update users set role = 'staff', permissions = '{orders,stock}'     where id = 'f0000000-0000-0000-0000-000000000002';
update users set role = 'staff', permissions = '{menu,open_close}'  where id = 'f0000000-0000-0000-0000-000000000003';
update users set role = 'staff', permissions = '{sales}'            where id = 'f0000000-0000-0000-0000-000000000004';
update users set role = 'rider' where id = 'f0000000-0000-0000-0000-000000000006';
insert into riders (id, user_id, name, phone) values ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000006', 'Rico', '09170000006');
select pg_temp.expect_error($q$update users set permissions = '{orders,hack}' where id = 'f0000000-0000-0000-0000-000000000002'$q$, 'users_permissions_known');

set role anon;
create temp table o on commit preserve rows as
  select place_order('{"customer_name":"Ana","customer_phone":"09171112222","order_type":"pickup","payment_method":"cash"}',
                     '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]') r;
reset role;
create temp table ids on commit preserve rows as
  select (select id from orders where public_token = (select (r->>'token')::uuid from o)) as order_id,
         (select id from item_options where is_active limit 1) as option_id;
grant select on ids to authenticated;
update orders set rider_id = 'f1000000-0000-0000-0000-000000000001' where id = (select order_id from ids);

-- ---- barista: orders + stock ----
set role authenticated; select pg_temp.as_user('f0000000-0000-0000-0000-000000000002');
select pg_temp.check(has_perm('orders') and has_perm('stock') and not has_perm('menu') and not is_admin(), 'barista has exactly the ticked permissions');
select pg_temp.check((select count(*) from orders) = 1 and (select count(*) from order_items) = 1, 'orders: sees the board and order lines');
select pg_temp.check((select count(*) from riders where id = 'f1000000-0000-0000-0000-000000000001') = 1, 'orders: sees riders to assign');
update orders set status = 'preparing';
select pg_temp.check((select status::text from orders) = 'preparing', 'orders: can accept and move orders');
update orders set total = 1, subtotal = 1;
select pg_temp.check((select total from orders) > 1, 'orders: totals stay locked');
select set_item_sold_out('30000000-0000-0000-0000-000000000013', true);
select set_option_available((select option_id from ids), false);
select pg_temp.check((select is_sold_out from menu_items where id = '30000000-0000-0000-0000-000000000013')
                     and not (select is_active from item_options where id = (select option_id from ids)), 'stock: sold-out and option switches work');
select set_item_sold_out('30000000-0000-0000-0000-000000000013', false);
select set_option_available((select option_id from ids), true);
update menu_items set price = 1;
select pg_temp.check((select min(price) from menu_items) > 1, 'no menu permission: prices unchanged');
select pg_temp.expect_error($q$select set_store_open(false)$q$, 'Not allowed: open/close');
select pg_temp.expect_error($q$select daily_summary()$q$, 'Not allowed: sales');
update store_settings set gcash_number = '09990000000';
update delivery_zones set fee = 0;
reset role;
select pg_temp.check((select gcash_number from store_settings) is distinct from '09990000000' and (select min(fee) from delivery_zones) > 0, 'no settings/zones permission: unchanged');

-- ---- kitchen lead: menu + open_close ----
set role authenticated; select pg_temp.as_user('f0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from orders) = 0, 'no orders permission: board is empty');
update menu_items set price = 155 where id = '30000000-0000-0000-0000-000000000013';
select set_item_sold_out('30000000-0000-0000-0000-000000000013', false);
select set_store_open(false);
reset role;
select pg_temp.check((select price from menu_items where id = '30000000-0000-0000-0000-000000000013') = 155, 'menu: can change prices');
select pg_temp.check(not (select is_open from store_settings), 'open_close: can close the store');
update store_settings set is_open = true;

-- ---- bookkeeper: sales only ----
set role authenticated; select pg_temp.as_user('f0000000-0000-0000-0000-000000000004');
select pg_temp.check((daily_summary()->>'orders')::int >= 1, 'sales: can see the summary');
select pg_temp.check((select count(*) from orders) = 0, 'sales: cannot browse orders');
select pg_temp.expect_error($q$select set_item_sold_out('30000000-0000-0000-0000-000000000013', true)$q$, 'Not allowed');

-- ---- nobody raises their own access ----
select pg_temp.expect_error($q$update users set permissions = '{orders,stock,open_close,menu,zones,refunds,sales,settings}' where id = 'f0000000-0000-0000-0000-000000000004'$q$, 'Only an admin');
select pg_temp.expect_error($q$update users set role = 'admin' where id = 'f0000000-0000-0000-0000-000000000004'$q$, 'Only an admin');

-- ---- customer + rider ----
select pg_temp.as_user('f0000000-0000-0000-0000-000000000005');
select pg_temp.check(not has_perm('orders') and (select count(*) from riders) = 0, 'customer has no staff rights');
select pg_temp.as_user('f0000000-0000-0000-0000-000000000006');
select pg_temp.check(not has_perm('orders') and (select count(*) from orders) = 1, 'rider: no staff rights, still sees their delivery');

-- ---- admin: everything ----
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
select pg_temp.check(has_perm('orders') and has_perm('settings') and has_perm('refunds') and is_admin(), 'admin has every permission');
update users set permissions = '{orders}' where id = 'f0000000-0000-0000-0000-000000000004';
update users set is_active = false where id = 'f0000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.as_user('');
select pg_temp.check((select permissions from users where id = 'f0000000-0000-0000-0000-000000000004') = '{orders}', 'admin can change permissions');

-- ---- switched off ----
set role authenticated; select pg_temp.as_user('f0000000-0000-0000-0000-000000000002');
select pg_temp.check(not has_perm('orders') and (select count(*) from orders) = 0, 'switched-off login loses its permissions at once');
select pg_temp.expect_error($q$select set_item_sold_out('30000000-0000-0000-0000-000000000013', true)$q$, 'Not allowed');
select pg_temp.expect_error($q$update users set is_active = true where id = 'f0000000-0000-0000-0000-000000000002'$q$, 'Only an admin');
reset role;
select pg_temp.as_user('');
update users set is_active = false where id = 'f0000000-0000-0000-0000-000000000001';
set role authenticated; select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
select pg_temp.check(not is_admin() and not has_perm('orders'), 'a switched-off admin loses admin rights');
reset role;

select 'ALL TEAM SCENARIOS PASSED';
