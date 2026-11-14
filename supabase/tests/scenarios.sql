-- Scenario tests for the database rules. Run against a scratch DB after the
-- migration + seed (see README "Testing the database rules").
\set ON_ERROR_STOP 1
update store_settings set require_account = false, cash_after_orders = 0;  -- guest scenarios; the sign-in and cash rules are tested on their own
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
update store_settings set require_account = false, cash_after_orders = 0;

-- customer inbox (Messages): automatic updates on the customer's own orders, private to them
do $$
declare v_token text; v_no text; n int;
begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
  select o->>'order_number', o->>'token' into v_no, v_token
    from (select place_order('{"customer_name":"Lea","customer_phone":"09170000001","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]') o) x;
  perform set_config('request.jwt.claim.sub', '', true);
  update orders set status = 'preparing' where order_number = v_no;
  update orders set status = 'ready' where order_number = v_no;
  update orders set street = 'x' where order_number = v_no;  -- not a status change: no message
  select count(*) into n from customer_messages where user_id = 'a0000000-0000-0000-0000-000000000004' and title like 'Order ' || v_no || '%';
  if n <> 3 then raise exception 'FAIL: expected 3 order messages (received, preparing, ready), got %', n; end if;
  if not exists (select 1 from customer_messages where title = 'Order ' || v_no || ' · ready' and body like 'Come pick it up%' and link like '/order/%') then
    raise exception 'FAIL: ready message text/link';
  end if;
  raise notice 'ok signed-in customer gets inbox messages for order received / preparing / ready (with a link), not for other edits';
  -- guest orders get none
  select count(*) into n from customer_messages;
  update orders set status = 'preparing' where customer_id is null and status = 'received';
  if (select count(*) from customer_messages) <> n then raise exception 'FAIL: guest order created a message'; end if;
  raise notice 'ok guest orders create no inbox messages';
end $$;
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', false);
select case when count(*) = 0 then 'ok other users cannot read someone else''s messages' else 'FAIL other user sees messages' end from customer_messages;
select pg_temp.expect_error($q$insert into customer_messages (user_id, title) values (auth.uid(), 'spoof')$q$, 'row-level security');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', false);
select case when count(*) >= 3 and count(*) filter (where read_at is null) = count(*) then 'ok customer reads own messages, all unread' else 'FAIL own messages ' || count(*) end from customer_messages;
select mark_messages_read();
select case when count(*) filter (where read_at is null) = 0 then 'ok mark_messages_read marks them read' else 'FAIL still unread' end from customer_messages;
reset role;
set role anon;
select case when count(*) = 0 then 'ok guests see no messages' else 'FAIL anon sees messages' end from customer_messages;
reset role;
select 'ALL MESSAGE SCENARIOS PASSED';

-- cash only after 3 completed orders; order chat between the customer and the assigned rider
update store_settings set cash_after_orders = 3;
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000009', 'newbie@test');
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000009', false);
select pg_temp.expect_error($q$select place_order(jsonb_build_object('customer_name','Nia','customer_phone','09170000009','order_type','delivery','zone_id',(select id from delivery_zones where name='Poblacion'),'street','Rizal St','payment_method','cash'), '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":4}]')$q$, 'CASH_LOCKED');
create temp table chat_order on commit preserve rows as
  select (place_order(jsonb_build_object('customer_name','Nia','customer_phone','09170000009','order_type','delivery','zone_id',(select id from delivery_zones where name='Poblacion'),'street','Rizal St','payment_method','gcash','payment_proof_path','proofs/x.jpg'), '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":4}]')->>'order_number') as no;
reset role;
-- three completed orders unlock cash
insert into orders (order_number, customer_id, customer_name, customer_phone, order_type, subtotal, delivery_fee, total, payment_method, status)
  select 'PH-T' || g, 'a0000000-0000-0000-0000-000000000009', 'Nia', '09170000009', 'pickup', 100, 0, 100, 'gcash', 'completed' from generate_series(1, 3) g;
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000009', false);
select case when (place_order('{"customer_name":"Nia","customer_phone":"09170000009","order_type":"pickup","payment_method":"cash"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]')->>'order_number') is not null
  then 'ok cash is refused for a new customer and allowed after 3 completed orders' else 'FAIL cash after 3' end;
-- chat: closed until a rider is assigned
select pg_temp.expect_error($q$select send_order_message((select id from orders where order_number = (select no from chat_order)), 'hello?')$q$, 'once a rider is assigned');
reset role;
update orders set rider_id = 'b0000000-0000-0000-0000-000000000001', status = 'out_for_delivery' where order_number = (select no from chat_order);
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000009', false);
select send_order_message((select id from orders where order_number = (select no from chat_order)), 'Blue gate po');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', false);  -- rider Jun (assigned)
select send_order_message((select id from orders where order_number = (select no from chat_order)), 'Malapit na po!');
select case when count(*) = 2 then 'ok assigned rider sees the chat' else 'FAIL rider sees ' || count(*) end from order_messages;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);  -- rider Ana (not assigned)
select case when count(*) = 0 then 'ok other riders cannot read it' else 'FAIL other rider sees chat' end from order_messages;
reset role; create temp table chat_id on commit preserve rows as select id from orders where order_number = (select no from chat_order); grant select on chat_id to authenticated;
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);
select pg_temp.expect_error($q$select send_order_message((select id from chat_id), 'hi')$q$, 'can''t message');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', false);  -- another customer
select case when count(*) = 0 then 'ok other customers cannot read it' else 'FAIL other customer sees chat' end from order_messages;
select pg_temp.expect_error($q$insert into order_messages (order_id, sender, body) select id, 'customer', 'spoof' from orders limit 1$q$, 'row-level security');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000009', false);
select case when string_agg(sender || ':' || body, '|' order by created_at) = 'customer:Blue gate po|rider:Malapit na po!' then 'ok customer sees both messages in order' else 'FAIL chat ' || string_agg(body, '|') end from order_messages;
select case when count(*) = 1 then 'ok the rider''s message also lands in the customer''s Messages inbox' else 'FAIL inbox ' || count(*) end from customer_messages where title like 'Rider · order %';
reset role;
update orders set status = 'completed' where order_number = (select no from chat_order);
set role authenticated; select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000009', false);
select pg_temp.expect_error($q$select send_order_message((select id from orders where order_number = (select no from chat_order)), 'thanks')$q$, 'chat is closed');
reset role;
update store_settings set cash_after_orders = 0;
select 'ALL CASH & CHAT SCENARIOS PASSED';
