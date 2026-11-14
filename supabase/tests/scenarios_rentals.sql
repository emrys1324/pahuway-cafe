-- Scenario tests for scooter rentals (0011 + 0012 + 0014): GCash receipt deposit, terms, pickup only, times, calendar.
\set ON_ERROR_STOP 1
update store_settings set require_account = false, cash_after_orders = 0;  -- guest scenarios; the sign-in and cash rules are tested on their own
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

insert into scooters (id, name, daily_rate) values
  ('a1000000-0000-0000-0000-000000000001', 'Honda Click 125', 500),
  ('a1000000-0000-0000-0000-000000000002', 'Yamaha Mio', 400);
update rental_settings set deposit_percent = 30, security_deposit = 2000, delivery_fee = 150, max_days = 14, grace_minutes = 60, turnaround_minutes = 30;
create temp table d as select ((now() at time zone 'Asia/Manila')::date + 3 + time '09:00') as t0;  -- Manila local 9:00 AM, 3 days ahead
grant select on d to anon, authenticated;
create or replace function pg_temp.at(h numeric) returns text language sql as $$ select to_char((select t0 from d) + make_interval(secs => h * 3600), 'YYYY-MM-DD"T"HH24:MI') $$;
create or replace function pg_temp.req(scooter text, s numeric, e numeric, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('scooter_id', scooter, 'pickup_at', pg_temp.at(s), 'return_at', pg_temp.at(e),
    'customer_name', 'Ana Reyes', 'customer_phone', '+63 917 111 2222', 'helmets', 2, 'license_path', 'licenses/ana.jpg',
    'terms_agreed', true, 'gcash_reference', '1012 345 678901', 'payment_proof_path', 'proofs/rentals/2026-11-12/ana.jpg') || extra
$$;

-- closed: switch off, or switch on but no terms yet
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 0, 48))$q$, 'CLOSED');
reset role;
update rental_settings set bookings_enabled = true;
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 0, 48))$q$, 'CLOSED');
reset role;
update rental_settings set terms = E'1. Bring a valid driver''s license.\n2. Return with the same fuel level.';

-- happy path: pickup only, 48 h = 2 days × ₱500 = ₱1,000; 30% deposit ₱300 paid by GCash, waiting for staff
set role anon;
create temp table b1 on commit preserve rows as
  select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 0, 48, '{"delivery": true, "delivery_address": "Resort"}')) r;
reset role;
select pg_temp.check((select (r->>'total')::numeric = 1000 and (r->>'deposit')::numeric = 300 and (r->>'days')::int = 2 from b1), '48 h = 2 days × ₱500 = ₱1,000 (delivery ignored: pickup only); 30% deposit ₱300');
select pg_temp.check((select payment_method = 'gcash' and payment_status = 'for_verification' and status = 'awaiting_deposit' and gcash_reference = '1012345678901'
                      and payment_proof_path like 'proofs/rentals/%' and not delivery and delivery_fee = 0 and payment_expires_at is null
                      and terms_agreed_at is not null and terms_snapshot like '1. Bring a valid%'
                      from rental_bookings where public_token = (select (r->>'token')::uuid from b1)), 'GCash receipt + reference saved, waiting for staff (no auto-expiry), agreed terms recorded');

-- security deposit per scooter; pay it now (with the deposit) or at pickup
reset role;
update scooters set security_deposit = 1500 where id = 'a1000000-0000-0000-0000-000000000002';
set role anon;
create temp table sd on commit preserve rows as select
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 320, 344, '{"security_upfront": true}')) up,
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 368, 392)) later;
select pg_temp.check((select (up->>'security_deposit')::numeric = 1500 and (up->>'security_upfront')::boolean and (up->>'pay_now')::numeric = (up->>'deposit')::numeric + 1500 from sd), 'scooter''s own ₱1,500 security deposit; ticked: paid now with the deposit (pay now = deposit + 1,500)');
select pg_temp.check((select (later->>'security_deposit')::numeric = 1500 and not (later->>'security_upfront')::boolean and (later->>'pay_now')::numeric = (later->>'deposit')::numeric from sd), 'unticked: security deposit is paid at pickup (pay now = deposit only)');
reset role;
update scooters set security_deposit = null where id = 'a1000000-0000-0000-0000-000000000002';
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 650, 654))->>'security_deposit')::numeric = 2000, 'a scooter without its own security deposit uses the default from settings (₱2,000)');
reset role;
update rental_settings set security_deposit = 0;
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 674, 678, '{"security_upfront": true}'))->>'security_upfront')::boolean = false, 'with no security deposit at all, the tickbox has no effect');
reset role;
update rental_settings set security_deposit = 2000;

-- pickup/return only within opening hours (default 8:00 AM – 10:00 PM)
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 502, 512))$q$, 'Pickup and return are from 8:00 AM to 10:00 PM only');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 503, 517.5))$q$, 'Pickup and return are from 8:00 AM to 10:00 PM only');
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 503, 517))->>'days')::int = 1, 'pickup at 8:00 AM and return at 10:00 PM are allowed (the edges of the hours)');
reset role;
update rental_settings set open_time = '06:00', close_time = '23:30';
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 550, 562))->>'days')::int = 1, 'owner-set hours apply (6:00 AM pickup allowed after widening the hours)');
reset role;
select pg_temp.expect_error($q$update rental_settings set open_time = '22:00', close_time = '08:00'$q$, 'rental_hours_valid');
select pg_temp.expect_error($q$update rental_settings set messenger_url = 'javascript:alert(1)'$q$, 'rental_messenger_url');
update rental_settings set open_time = '08:00', close_time = '22:00', messenger_url = 'https://m.me/baybayin';

-- online deposit (HitPay): only when switched on; no GCash receipt needed; 30-minute hold
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 408, 432, '{"payment_method": "online", "gcash_reference": null, "payment_proof_path": null}'))$q$, 'Online payment is not available');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 408, 432, '{"payment_method": "cash"}'))$q$, 'choose how to pay');
reset role;
update rental_settings set online_enabled = true;
set role anon;
create temp table b_online on commit preserve rows as
  select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 408, 432, '{"payment_method": "online", "gcash_reference": null, "payment_proof_path": null}')) r;
reset role;
select pg_temp.check((select payment_method = 'online' and payment_status = 'awaiting_payment' and gcash_reference is null and payment_proof_path is null
                      and payment_expires_at between now() + interval '29 minutes' and now() + interval '31 minutes' and terms_snapshot is not null
                      from rental_bookings where public_token = (select (r->>'token')::uuid from b_online)) and (select r->>'payment_method' from b_online) = 'online',
                     'online deposit (switch on): no receipt needed, waiting for HitPay, held 30 minutes, terms recorded');
update rental_bookings set payment_expires_at = now() - interval '1 minute' where public_token = (select (r->>'token')::uuid from b_online);
select public.expire_unpaid_bookings();
select pg_temp.check((select status = 'cancelled' from rental_bookings where public_token = (select (r->>'token')::uuid from b_online)), 'an unpaid online hold is released after 30 minutes');

-- 24-hour blocks with grace; back-to-back with turnaround
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 100, 108))->>'days')::int = 1, '8 hours = 1 day');
create temp table q on commit preserve rows as select
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 120, 144.5)) a,
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 200, 226)) b,
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 241, 271)) c,
  book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 263, 294)) e;
select pg_temp.check((select (a->>'days')::int = 1 and (a->>'excess_hours')::int = 1 and (a->>'excess_fee')::numeric = 50 from q), '24.5 hours = 1 day + 1 extra hour (₱50; part of an hour counts as an hour)');
select pg_temp.check((select (b->>'days')::int = 1 and (b->>'excess_hours')::int = 2 and (b->>'total')::numeric = (select daily_rate from scooters where id = 'a1000000-0000-0000-0000-000000000002') + 100 from q), '26 hours = 1 day + 2 extra hours × ₱50, included in the total');
select pg_temp.check((select (c->>'days')::int = 1 and (c->>'excess_hours')::int = 6 and (c->>'excess_fee')::numeric = 300 from q), '30 hours = 1 day + 6 extra hours (the most charged by the hour)');
select pg_temp.check((select (e->>'days')::int = 2 and (e->>'excess_hours')::int = 0 from q), '31 hours = 2 days (7 extra hours count as another day)');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 47, 50))$q$, 'UNAVAILABLE');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 48, 52))$q$, 'UNAVAILABLE');
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 48.5, 56))->>'days')::int = 1, 'next pickup allowed 30 min after the return (turnaround)');
select pg_temp.check((select count(*) from busy_scooters(((select t0 from d) + interval '10 hours') at time zone 'Asia/Manila', ((select t0 from d) + interval '12 hours') at time zone 'Asia/Manila')) = 1, 'a booking waiting for GCash verification already holds the scooter');

-- validation
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"terms_agreed": false}'))$q$, 'terms and conditions');
create temp table b_noref on commit preserve rows as
  select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"gcash_reference": null}')) r;
reset role;
select pg_temp.check((select gcash_reference is null and payment_status = 'for_verification' from rental_bookings where public_token = (select (r->>'token')::uuid from b_noref)), 'GCash booking without a reference number is accepted (the receipt screenshot is enough)');
update rental_bookings set status = 'cancelled', cancel_reason = 'test' where public_token = (select (r->>'token')::uuid from b_noref);
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"payment_proof_path": null}'))$q$, 'screenshot of your GCash');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"payment_proof_path": "proofs/2026/cafe-order.jpg"}'))$q$, 'screenshot of your GCash');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300.25, 312))$q$, 'hour or half hour');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', -100, -90))$q$, 'pickup time has passed');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 300.5))$q$, 'at least 1 hour');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 700))$q$, 'up to 14 days');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"customer_phone": "12345"}'))$q$, '09XXXXXXXXX');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 300, 312, '{"license_path": null}'))$q$, 'license');
select pg_temp.expect_error($q$insert into rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, start_date, end_date, pickup_at, return_at, blocked_until, days, daily_rate, total, deposit_amount, license_path) values ('a1000000-0000-0000-0000-000000000002','x','x','09171112222',current_date,current_date,now(),now()+interval '2 hours',now()+interval '2 hours',1,1,1,1,'licenses/x')$q$, 'row-level security');

-- guests: no table access; status by link; calendar without personal details
select pg_temp.check((select count(*) from rental_bookings) = 0, 'guests cannot read bookings');
select pg_temp.check(get_booking_by_token((select (r->>'token')::uuid from b1))->>'payment_status' = 'for_verification', 'booking status by its secret link');
select pg_temp.check((select count(*) from scooter_calendar((select t0 from d)::date, (select t0 from d)::date + 3) where scooter_id = 'a1000000-0000-0000-0000-000000000001') = 2, 'calendar lists taken time ranges per scooter');
select pg_temp.check(pg_get_function_result('public.scooter_calendar(date,date)'::regprocedure) = 'TABLE(scooter_id uuid, pickup_at timestamp with time zone, blocked_until timestamp with time zone)', 'calendar returns only scooter + times (no personal details)');
reset role;

-- staff with the rentals permission verify GCash deposits and run the booking; others can't
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-000000000001', 'renter@t.test'), ('b0000000-0000-0000-0000-000000000002', 'barista@t.test');
update users set role = 'staff', permissions = '{rentals}' where id = 'b0000000-0000-0000-0000-000000000001';
update users set role = 'staff', permissions = '{orders}'  where id = 'b0000000-0000-0000-0000-000000000002';
create temp table tok as select (r->>'token')::uuid as t from b1;
grant select on tok to authenticated;
set role authenticated; select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from rental_bookings) = 0, 'staff without the Rentals permission see no bookings');
select pg_temp.as_user('b0000000-0000-0000-0000-000000000001');
update rental_bookings set payment_status = 'deposit_paid', status = 'confirmed', gcash_reference = 'tampered', total = 1 where public_token = (select t from tok);
select pg_temp.check((select status = 'confirmed' and payment_status = 'deposit_paid' and deposit_paid_at is not null and gcash_reference = '1012345678901' and total = 1000
                      from rental_bookings where public_token = (select t from tok)), 'Rentals staff verify the GCash deposit → confirmed (time stamped); reference and price stay locked');
update rental_bookings set status = 'picked_up' where public_token = (select t from tok);
select pg_temp.check((select picked_up_at is not null from rental_bookings where public_token = (select t from tok)), 'marks picked up');
update rental_bookings set status = 'returned' where public_token = (select t from tok);
select pg_temp.check((select returned_at is not null and blocked_until = greatest(least(return_at + interval '30 minutes', now()), pickup_at + interval '1 minute') from rental_bookings where public_token = (select t from tok)), 'marking it returned frees the scooter right away (no longer blocked until the scheduled return)');
reset role;
select pg_temp.check((select count(*) from busy_scooters(((select t0 from d) + interval '2 hours') at time zone 'Asia/Manila', ((select t0 from d) + interval '4 hours') at time zone 'Asia/Manila') where busy_scooters = 'a1000000-0000-0000-0000-000000000001') = 0
                     and (select count(*) from scooter_calendar((select t0 from d)::date, (select t0 from d)::date + 3) c join rental_bookings b on b.scooter_id = c.scooter_id and b.pickup_at = c.pickup_at where b.public_token = (select t from tok) and c.blocked_until > b.pickup_at + interval '1 minute') = 0,
                     'a returned scooter shows as free (booking page + calendar)');
set role authenticated; select pg_temp.as_user('b0000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($q$update rental_bookings set status = 'cancelled' where public_token = (select t from tok)$q$, 'check');
update rental_settings set terms = 'New terms v2';
reset role; select pg_temp.as_user('');
select pg_temp.check((select terms from rental_settings) = 'New terms v2' and (select terms_snapshot from rental_bookings where public_token = (select t from tok)) like '1. Bring%', 'staff can edit the terms; existing bookings keep the version the customer agreed to');

-- overdue: picked up, past its return (+ turnaround), not returned → blocked for every date until returned
reset role; select pg_temp.as_user('');
insert into rental_bookings (scooter_id, scooter_name, customer_name, customer_phone, start_date, end_date, pickup_at, return_at, blocked_until,
                             days, daily_rate, total, deposit_amount, license_path, status, payment_status)
values ('a1000000-0000-0000-0000-000000000002', 'Yamaha Mio', 'Late Larry', '09170000009', current_date - 2, current_date - 1,
        now() - interval '2 days', now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', 1, 400, 400, 120, 'licenses/x.jpg', 'picked_up', 'deposit_paid');
select pg_temp.check((select count(*) from busy_scooters(now() + interval '60 days', now() + interval '61 days') where busy_scooters = 'a1000000-0000-0000-0000-000000000002') = 1, 'an overdue scooter shows as unavailable, even for dates weeks ahead');
select pg_temp.check((select max(blocked_until) > now() + interval '300 days' from scooter_calendar(current_date, current_date + 90) where scooter_id = 'a1000000-0000-0000-0000-000000000002'), 'the calendar greys out the overdue scooter for every day');
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 600, 610))$q$, 'is not back yet');
reset role;
update rental_bookings set status = 'returned' where customer_name = 'Late Larry';
select pg_temp.check((select count(*) from busy_scooters(now() + interval '60 days', now() + interval '61 days') where busy_scooters = 'a1000000-0000-0000-0000-000000000002') = 0, 'once marked returned, the scooter is free again');
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 600, 610))->>'days')::int = 1, 'and it can be booked again');
reset role;

-- number of units: 2 × Yamaha can be out at the same time; a third overlapping booking is refused
update scooters set units = 2 where id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$update scooters set units = 0 where id = 'a1000000-0000-0000-0000-000000000002'$q$, 'scooter_units_range');
set role anon;
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 700, 724))->>'days')::int = 1, 'units: first Yamaha booked');
select pg_temp.check((select free from scooter_availability(((select t0 from d) + interval '701 hours') at time zone 'Asia/Manila', ((select t0 from d) + interval '702 hours') at time zone 'Asia/Manila') where scooter_id = 'a1000000-0000-0000-0000-000000000002') = 1, 'units: 1 of 2 left while one is booked');
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 703, 727))->>'days')::int = 1, 'units: a second overlapping booking fits (2 units)');
select pg_temp.check((select count(*) from busy_scooters(((select t0 from d) + interval '704 hours') at time zone 'Asia/Manila', ((select t0 from d) + interval '705 hours') at time zone 'Asia/Manila') where busy_scooters = 'a1000000-0000-0000-0000-000000000002') = 1, 'units: shown as booked once both units are taken');
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 701, 725))$q$, 'UNAVAILABLE');
select pg_temp.check((book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000002', 725, 749))->>'days')::int = 1, 'units: once the first is back (+30 min), its unit is free again even though the second is still out');
reset role;

-- accounts required: guests can't book; a signed-in customer's booking is linked to them and visible to them
update store_settings set require_account = true;
set role anon;
select pg_temp.expect_error($q$select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 800, 824))$q$, 'SIGN_IN');
reset role;
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000001', 'cust@t.test');
set role authenticated; select pg_temp.as_user('c0000000-0000-0000-0000-000000000001');
create temp table own on commit preserve rows as select book_scooter(pg_temp.req('a1000000-0000-0000-0000-000000000001', 800, 824)) r;
select pg_temp.check((select count(*) from rental_bookings) = 1 and (select customer_user_id from rental_bookings) = 'c0000000-0000-0000-0000-000000000001', 'signed-in customer books; the booking is linked to their account and they see only their own');
reset role; select pg_temp.as_user('');
update store_settings set require_account = false, cash_after_orders = 0;

-- inbox messages for the customer's booking: received → confirmed → cancelled (+ refund); guests' bookings get none
update rental_bookings set status = 'confirmed' where customer_user_id = 'c0000000-0000-0000-0000-000000000001';
update rental_bookings set status = 'cancelled', cancel_reason = 'test' where customer_user_id = 'c0000000-0000-0000-0000-000000000001';
update rental_bookings set payment_status = 'refunded' where customer_user_id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from customer_messages where user_id = 'c0000000-0000-0000-0000-000000000001') = 4
  and exists (select 1 from customer_messages where title like 'Booking % · confirmed' and body like 'Your % is reserved%' and link like '/baybayin/booking/%'),
  'booking messages: received, confirmed, cancelled, deposit refunded (with a link to the booking)');
select pg_temp.check((select count(*) from customer_messages where user_id <> 'c0000000-0000-0000-0000-000000000001') = 0, 'guest bookings create no messages');

select 'ALL RENTAL SCENARIOS PASSED';
