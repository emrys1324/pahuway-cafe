-- Scenario tests for 0005_online_payments.sql (needs real Supabase: pg_net, pg_cron).
\set ON_ERROR_STOP 1
update store_settings set require_account = false, cash_after_orders = 0;  -- guest scenarios; the sign-in and cash rules are tested on their own
update store_settings set open_time = '00:00', close_time = '00:00', is_open = true, online_payments_enabled = false;

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

insert into private.app_config values ('push_webhook_url', 'http://127.0.0.1:9/x'), ('push_webhook_secret', 's')
on conflict (key) do update set value = excluded.value;

-- 1. disabled → refused
set role anon;
select pg_temp.expect_error($q$select place_order('{"customer_name":"Ana","customer_phone":"09171112222","order_type":"pickup","payment_method":"online"}', '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":2}]')$q$, 'Online payment isn''t available');
reset role;
update store_settings set online_payments_enabled = true;

-- 2. online order: awaiting payment, 30-min window, NO staff alert yet
begin;
set local role anon;
create temp table o1 on commit preserve rows as select place_order('{"customer_name":"Ana","customer_phone":"09171112222","order_type":"pickup","payment_method":"online"}',
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":2}]') r;
reset role;
select pg_temp.check((select payment_status::text = 'awaiting_payment' and payment_expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'
                     from orders where public_token = (select (r->>'token')::uuid from o1)), 'online order awaits payment with a 30-minute window');
select pg_temp.check(not exists (select 1 from net.http_request_queue where convert_from(body,'utf8') like '%"new_order": true%'), 'no staff alert for an unpaid online order');
commit;
grant select on o1 to anon;

-- checkout session attached by the server
update orders set gateway_ref = 'cs_test_1', checkout_url = 'https://securecheckout.hit-pay.com/payment-request/@pahuway/cs_test_1/checkout'
 where public_token = (select (r->>'token')::uuid from o1);
set role anon;
select pg_temp.check(get_order_by_token((select (r->>'token')::uuid from o1))->>'checkout_url' = 'https://securecheckout.hit-pay.com/payment-request/@pahuway/cs_test_1/checkout', 'customer can resume payment via the status link');
select pg_temp.expect_error($q$select mark_order_paid('cs_test_1', 'pay_x', 15000)$q$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.expect_error($q$select mark_order_paid('cs_test_1', 'pay_x', 15000)$q$, 'permission denied');
reset role;

-- 3. webhook marks paid (service role): amount check, idempotency, staff alert fires now
set role service_role;
select pg_temp.check(mark_order_paid('cs_unknown', 'pay_x', 15000) = 'not_found', 'unknown checkout ignored');
select pg_temp.check(mark_order_paid('cs_test_1', 'pay_x', 100) = 'amount_mismatch', 'wrong amount refused');
reset role;
select pg_temp.check((select payment_status::text from orders where gateway_ref = 'cs_test_1') = 'awaiting_payment', 'order still unpaid after mismatch');
begin;
set local role service_role;
select pg_temp.check(mark_order_paid('cs_test_1', 'pay_123', 15000) = 'paid', 'correct amount (₱150 = 15000 centavos) marks the order paid');
reset role;
select pg_temp.check(count(*) = 1, 'staff alert fires when the online order is paid')
  from net.http_request_queue where convert_from(body,'utf8') like '%"new_order": true%';
commit;
set role service_role;
select pg_temp.check(mark_order_paid('cs_test_1', 'pay_123', 15000) = 'already_paid', 'duplicate webhook is harmless');
reset role;
select pg_temp.check((select paid_at is not null and gateway_payment_id = 'pay_123' from orders where gateway_ref = 'cs_test_1'), 'payment id and time recorded');
set role anon;
select pg_temp.check(get_order_by_token((select (r->>'token')::uuid from o1))->>'checkout_url' is null, 'pay link hidden once paid');
reset role;

-- 4. expiry + paid-after-cancel
set role anon;
create temp table o2 as select place_order('{"customer_name":"Ben","customer_phone":"09173334444","order_type":"pickup","payment_method":"online"}',
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000014","quantity":1}]') r;
reset role;
update orders set gateway_ref = 'cs_test_2', payment_expires_at = now() - interval '1 minute'
 where public_token = (select (r->>'token')::uuid from o2);
select pg_temp.check(expire_unpaid_orders() = 1, 'expired unpaid order cancelled by the job');
select pg_temp.check((select status::text = 'cancelled' and cancel_reason like 'Online payment was not completed%' from orders where gateway_ref = 'cs_test_2'), 'cancel reason explains the missed payment');
select pg_temp.check(expire_unpaid_orders() = 0, 'paid orders are never expired');
set role service_role;
select pg_temp.check(mark_order_paid('cs_test_2', 'pay_late', 8500) = 'paid_after_cancel', 'late payment on a cancelled order is flagged for refund');
reset role;

-- 5. a still-unpaid abandoned checkout is left out of the sales summary
set role anon;
select place_order('{"customer_name":"Cara","customer_phone":"09175556666","order_type":"pickup","payment_method":"online"}',
  '[{"menu_item_id":"30000000-0000-0000-0000-000000000013","quantity":1}]') is not null;
reset role;
insert into auth.users (id, email, aud, role) values ('d0000000-0000-0000-0000-000000000001', 'boss@test', 'authenticated', 'authenticated');
update users set role = 'admin' where id = 'd0000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', false);
select pg_temp.check((daily_summary()->>'orders')::int = 2, 'summary counts the 2 paid orders, not the abandoned checkout');
reset role;
select pg_temp.check(exists (select 1 from cron.job where jobname = 'expire-unpaid-orders'), 'expiry job scheduled every 5 minutes');
delete from private.app_config;
select 'ALL PAYMENT SCENARIOS PASSED';
