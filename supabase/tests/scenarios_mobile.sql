-- Scenario tests for 0002_mobile_app.sql (needs real Supabase: pg_net + auth schema).
\set ON_ERROR_STOP 1
update store_settings set require_account = false, cash_after_orders = 0;  -- guest scenarios; the sign-in and cash rules are tested on their own
update store_settings set open_time = '00:00', close_time = '00:00', is_open = true;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'Wrong error. Expected "%", got "%"', needle, sqlerrm; end if;
    raise notice 'ok (rejected): %', sqlerrm;
    return;
  end;
  raise exception 'FAIL: statement should have been rejected: %', sql;
end $$;

create or replace function pg_temp.check(ok boolean, msg text) returns text language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  return 'ok ' || msg;
end $$;

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-0000-0000-000000000001', 'admin1@test', 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000002', 'cust1@test',  'authenticated', 'authenticated');
update public.users set role = 'admin' where id = 'c0000000-0000-0000-0000-000000000001';

-- configure webhook so the trigger fires
insert into private.app_config values ('push_webhook_url', 'http://127.0.0.1:9/api/push/order-event'), ('push_webhook_secret', 'test-secret')
on conflict (key) do update set value = excluded.value;

-- private schema is not reachable by API roles
set role anon;
select pg_temp.expect_error($q$select * from private.app_config$q$, 'permission denied');
select pg_temp.expect_error($q$select * from push_tokens$q$, 'permission denied');
reset role;

-- customer registers a push token, places an order, guest device subscribes.
-- Webhook checks run inside a transaction so pg_net's worker can't send (and dequeue) the request first.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
select register_push_token('fcm-token-customer-0000000000000000', 'android');
create temp table o on commit preserve rows as select place_order('{"customer_name":"Lea","customer_phone":"09170000001","order_type":"pickup","payment_method":"cash"}',
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]') r;
grant select on o to anon;
reset role;
select pg_temp.check(count(*) = 1, 'webhook queued for new order')
  from net.http_request_queue where convert_from(body, 'utf8') like '%"new_order": true%';
commit;

set role authenticated; select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false);
select pg_temp.expect_error($q$select register_push_token('short', 'android')$q$, 'Invalid push token');
select pg_temp.expect_error($q$select register_push_token('fcm-token-xxxxxxxxxxxxxxxxxxxxxxxx', 'windows')$q$, 'Invalid platform');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select subscribe_order_push('fcm-token-guest-00000000000000000000', 'ios', (select (r->>'token')::uuid from o));
select pg_temp.expect_error(format($q$select subscribe_order_push('fcm-token-guest-00000000000000000000', 'ios', '%s')$q$, gen_random_uuid()), 'Order not found');
reset role;
select pg_temp.check(count(*) = 2, '2 push tokens stored') from push_tokens;
select pg_temp.check(user_id = 'c0000000-0000-0000-0000-000000000002', 'customer token linked to account') from push_tokens where token like 'fcm-token-customer%';
select pg_temp.check(count(*) = 1, 'guest subscribed to order') from order_push_subscriptions;

begin;
update orders set status = 'preparing' where customer_name = 'Lea';
select pg_temp.check(count(*) = 1, 'webhook queued for status change')
  from net.http_request_queue where convert_from(body, 'utf8') like '%"status_changed": true%';
update orders set payment_status = 'paid' where customer_name = 'Lea';  -- not push-worthy
select pg_temp.check(count(*) = 1, 'no webhook for a non-notifiable change')
  from net.http_request_queue where convert_from(body, 'utf8') like '%"order_id"%';
select pg_temp.check(count(*) = 1, 'webhook carries the shared secret header')
  from net.http_request_queue where headers->>'x-push-secret' = 'test-secret';
commit;

-- unregister on sign-out keeps token but unlinks user
set role authenticated; select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false);
select unregister_push_token('fcm-token-customer-0000000000000000');
reset role;
select pg_temp.check(user_id is null, 'token unlinked on sign-out') from push_tokens where token like 'fcm-token-customer%';

-- account deletion
set role authenticated; select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', false);
select pg_temp.expect_error($q$select delete_my_account()$q$, 'only admin');
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false);
select register_push_token('fcm-token-customer-0000000000000000', 'android');
select delete_my_account();
reset role;
select pg_temp.check(not exists (select 1 from auth.users where id = 'c0000000-0000-0000-0000-000000000002')
             and not exists (select 1 from public.users where id = 'c0000000-0000-0000-0000-000000000002'), 'customer account deleted');
select pg_temp.check(count(*) = 1 and bool_and(customer_id is null), 'order kept, unlinked from deleted account') from orders where customer_name = 'Lea';
select pg_temp.check(not exists (select 1 from push_tokens where token like 'fcm-token-customer%'), 'deleted account push token removed');
set role anon;
select pg_temp.expect_error($q$select delete_my_account()$q$, 'permission denied');
reset role;
delete from private.app_config;
select 'ALL MOBILE SCENARIOS PASSED';
