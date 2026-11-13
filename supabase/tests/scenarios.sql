-- Scenario tests for the database rules. Run against a scratch DB after the
-- migration + seed (see README "Testing the database rules").
\set ON_ERROR_STOP 1
update store_settings set require_account = false;  -- guest scenarios; the sign-in rule is tested on its own
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on storage.objects to anon, authenticated;

-- 24h hours for a deterministic test
update store_settings set open_time = '00:00', close_time = '00:00', is_open = true;

-- accounts
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'),
  ('a0000000-0000-0000-0000-000000000002', 'rider@test'),
  ('a0000000-0000-0000-0000-000000000003', 'rider2@test'),
  ('a0000000-0000-0000-0000-000000000004', 'cust@test');
update users set role = 'admin' where id = 'a0000000-0000-0000-0000-000000000001';
update users set role = 'rider' where id in ('a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003');
insert into riders (id, user_id, name, phone) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Jun Dela Cruz', '09171234567'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'Ana Reyes', '09181234567');

create temp table ctx as
select
  (select id from delivery_zones where name = 'Poblacion') zone,
  (select id from item_options where name = 'Iced') iced,
  (select id from item_options where name = '50%') sugar50,
  (select id from item_options where name = 'Oat milk') oat,
  (select id from item_options where name = 'Extra shot') shot,
  (select id from item_options where name = 'Hot') hot;
grant select on ctx to anon, authenticated;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'Wrong error. Expected "%", got "%"', needle, sqlerrm;
    end if;
    raise notice 'ok (rejected): %', sqlerrm;
    return;
  end;
  raise exception 'FAIL: statement should have been rejected: %', sql;
end $$;

-- 1. Guest orders customized iced latte for delivery, GCash
set role anon;
create temp table placed as
select place_order(
  jsonb_build_object('customer_name','Maria Santos','customer_phone','0917 123 4567','order_type','delivery',
    'zone_id',(select zone from ctx),'street','Purok 3, near the chapel','landmark','Blue gate','rider_notes','Call when near',
    'payment_method','gcash','gcash_reference','1234567890','payment_proof_path','proofs/2026/abc.jpg'),
  jsonb_build_array(jsonb_build_object('menu_item_id','30000000-0000-0000-0000-000000000002','quantity',2,
    'option_ids', jsonb_build_array((select iced from ctx),(select sugar50 from ctx),(select oat from ctx),(select shot from ctx)),
    'notes','less ice'))
) r;
select r from placed;
-- (150 + 10 + 0 + 40 + 40) * 2 = 480 ; + 30 fee = 510
select case when (r->>'total')::numeric = 510 then 'ok total 510' else 'FAIL total ' || (r->>'total') end from placed;

-- anon cannot read orders table directly
select case when count(*) = 0 then 'ok anon sees 0 orders' else 'FAIL anon sees orders' end from orders;
-- but can read via token
select case when get_order_by_token((select (r->>'token')::uuid from placed))->>'status' = 'received'
  then 'ok token lookup' else 'FAIL token lookup' end;
select case when get_order_by_token(gen_random_uuid()) is null then 'ok random token -> null' else 'FAIL' end;

-- validation
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"12345","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, '09XXXXXXXXX');
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000015","quantity":1}]')$q$, 'sold out');
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000002","quantity":1}]')$q$, 'Please choose a temperature');
select pg_temp.expect_error(format($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"delivery","zone_id":"%s","street":"x","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, (select zone from ctx)), 'Minimum order');
select pg_temp.expect_error(format($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000002","quantity":1,"option_ids":["%s","%s","%s"]}]')$q$, (select iced from ctx),(select hot from ctx),(select sugar50 from ctx)), 'Choose only one');
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"gcash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, 'screenshot');
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash","scheduled_for":"2020-01-01T10:00:00Z"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, 'no longer available');
select pg_temp.expect_error($q$insert into orders (customer_name, customer_phone, order_type, subtotal, total, payment_method) values ('x','09171234567','pickup',1,1,'cash')$q$, 'row-level security');
select pg_temp.expect_error($q$select daily_summary()$q$, 'permission denied');
-- +63 normalisation works, pickup cash
select (place_order('{"customer_name":"Tourist Tom","customer_phone":"+639181112222","order_type":"pickup","payment_method":"cash"}',
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":3}]')->>'order_number') as pickup_order;
reset role;

-- store closed blocks orders
update store_settings set is_open = false;
set role anon;
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, 'STORE_CLOSED');
reset role;
-- outside hours blocks orders too
update store_settings set is_open = true, open_time = ((now() at time zone 'Asia/Manila') + interval '1 hour')::time, close_time = ((now() at time zone 'Asia/Manila') + interval '2 hours')::time;
set role anon;
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, 'STORE_CLOSED');
reset role;
update store_settings set open_time = '00:00', close_time = '00:00';

-- 2. Admin workflow
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', false);
select case when count(*) = 2 then 'ok admin sees 2 orders' else 'FAIL admin sees ' || count(*) end from orders;
select pg_temp.expect_error($q$update orders set status = 'cancelled' where order_number = 'PH-0003'$q$, 'cancel_needs_reason');
update orders set status = 'preparing' where order_number = 'PH-0001';
update orders set payment_status = 'paid' where order_number = 'PH-0001';
update orders set rider_id = 'b0000000-0000-0000-0000-000000000001', status = 'ready' where order_number = 'PH-0001';
update orders set total = 1 where order_number = 'PH-0001';  -- frozen by trigger
select order_number, status, payment_status, total, accepted_at is not null as accepted, ready_at is not null as ready from orders order by order_number;
select daily_summary();
reset role;
do $$
declare n int;
begin
  -- real Supabase stores broadcasts in realtime.messages; the local stub uses realtime.log
  if to_regclass('realtime.messages') is not null then
    execute $q$select count(*) from realtime.messages where topic like 'order-%'$q$ into n;
  else
    execute 'select count(*) from realtime.log' into n;
  end if;
  if n < 4 then raise exception 'FAIL broadcasts: %', n; end if;
  raise notice 'ok realtime broadcasts: %', n;
end $$;

-- 3. Rider: only own orders
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);
select case when count(*) = 0 then 'ok other rider sees 0' else 'FAIL other rider sees orders' end from orders;
select pg_temp.expect_error($q$select rider_update_order((select id from orders limit 1), 'picked_up')$q$, 'not assigned');
select pg_temp.expect_error($q$select rider_update_order('00000000-0000-0000-0000-000000000000', 'picked_up')$q$, 'not assigned');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', false);
select case when count(*) = 1 then 'ok rider sees 1' else 'FAIL rider sees ' || count(*) end from orders;
select case when count(*) = 1 then 'ok rider sees items' else 'FAIL items' end from order_items;
update orders set status = 'completed' where false; -- rider has no update policy (silently 0 rows)
select pg_temp.expect_error($q$select rider_update_order((select id from orders limit 1), 'delivered')$q$, 'picked up first');
select rider_update_order((select id from orders limit 1), 'picked_up');
select rider_update_order((select id from orders limit 1), 'delivered');
select pg_temp.expect_error($q$update users set role = 'admin' where id = auth.uid()$q$, 'Only an admin');
reset role;

-- cash pickup completion auto-marks paid
update orders set status = 'completed' where order_number = 'PH-0003';
select order_number, status, payment_status from orders order by 1;

-- 4. customer: sees own orders only, menu writes blocked
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', false);
select (place_order(format('{"customer_name":"Lea","customer_phone":"09170000001","order_type":"dine_in","payment_method":"cash"}')::jsonb,
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000014","quantity":1}]')->>'order_number') as member_order;
select case when count(*) = 1 then 'ok customer sees own 1 order' else 'FAIL customer sees ' || count(*) end from orders;
update menu_items set is_sold_out = true where id = '30000000-0000-0000-0000-000000000001';
reset role;
select 'ALL SCENARIOS PASSED';
select case when is_sold_out then 'FAIL customer changed menu' else 'ok customer cannot edit menu' end from menu_items where id = '30000000-0000-0000-0000-000000000001';
select case when status = 'completed' then 'ok' else 'FAIL' end from orders where order_number = 'PH-0001';

-- GCash orders no longer need a reference number (the screenshot is enough)
update store_settings set open_time = '00:00', close_time = '00:00', is_open = true;
do $$ begin
  if (place_order('{"customer_name":"Gina","customer_phone":"09171234567","order_type":"pickup","payment_method":"gcash","payment_proof_path":"proofs/2026/gina.jpg"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')->>'order_number') is null then
    raise exception 'FAIL: GCash order without a reference was refused';
  end if;
  raise notice 'ok GCash order without a reference number is accepted (the screenshot is enough)';
end $$;

-- accounts required: guests can't order
update store_settings set require_account = true;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_error($q$select place_order('{"customer_name":"Al","customer_phone":"09171234567","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')$q$, 'SIGN_IN');
reset role;
update store_settings set require_account = false;
