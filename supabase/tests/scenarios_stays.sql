-- Scenario tests for Padaya Stays (0033): pricing, availability by units, rules, privacy, inbox messages.
\set QUIET on
\pset tuples_only on
create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'FAIL expected error containing %', needle;
  raise exception 'FAIL expected error containing %', needle;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if position(needle in sqlerrm) = 0 then raise exception 'FAIL expected "%" got "%"', needle, sqlerrm; end if;
  raise notice 'ok error "%"', needle;
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns text language plpgsql as $$
begin if ok then return 'ok ' || msg; end if; raise exception 'FAIL %', msg; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- a Monday about a month ahead
create temp table d on commit preserve rows as
  select (current_date + 30 + ((8 - extract(isodow from current_date + 30)::int) % 7))::date as mon;
grant select on d to anon, authenticated;
create or replace function pg_temp.day(n int) returns text language sql as $$ select to_char((select mon from d) + n, 'YYYY-MM-DD') $$;
create or replace function pg_temp.req(room text, a int, b int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('room_id', room, 'check_in', pg_temp.day(a), 'check_out', pg_temp.day(b), 'guests', 2,
    'customer_name', 'Stella Stay', 'customer_phone', '09171234567', 'id_photo_path', 'licenses/stays/x/id.jpg',
    'payment_proof_path', 'proofs/stays/x/p.jpg', 'terms_agreed', true) || extra
$$;
update store_settings set require_account = false;

select pg_temp.check((select count(*) from stay_properties where name = 'Sample property — edit me' and not is_active) = 1
  and (select count(*) from stay_rooms where name = 'Sample room — edit me') = 1
  and (select slug from businesses b join stay_properties p on p.business_id = b.id limit 1) = 'padaya-stays',
  'a hidden sample property + room come ready to edit, under Padaya Stays');
select pg_temp.check((select deposit_percent = 30 and free_cancel_days = 3 and not bookings_enabled from stay_settings), 'defaults: 30% deposit, free cancellation 3 days before, bookings off');

insert into stay_properties (id, name, location_text, is_active) values ('b2000000-0000-0000-0000-000000000001', 'Casa Tablas', 'San Agustin', true);
insert into stay_rooms (id, property_id, name, nightly_rate, weekend_rate, max_guests, units, min_nights, is_active) values
  ('b2000000-0000-0000-0000-0000000000a1', 'b2000000-0000-0000-0000-000000000001', 'Garden room', 1800, 2200, 2, 1, 1, true),
  ('b2000000-0000-0000-0000-0000000000a2', 'b2000000-0000-0000-0000-000000000001', 'Family suite', 3000, null, 4, 2, 2, true);

-- closed until switched on with terms
set role anon;
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 0, 2))$q$, 'CLOSED');
reset role;
update stay_settings set bookings_enabled = true;
set role anon;
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 0, 2))$q$, 'CLOSED');
reset role;
update stay_settings set terms = 'Quiet hours 10 PM. Free cancellation up to 3 days before.';

-- price: Mon→Thu = 3 weekday nights; Thu→Sun = Thu (weekday) + Fri + Sat (weekend)
select pg_temp.check(stay_price('b2000000-0000-0000-0000-0000000000a1', (select mon from d), (select mon from d) + 3) = 5400, 'Mon–Thu: 3 × ₱1,800 = ₱5,400');
select pg_temp.check(stay_price('b2000000-0000-0000-0000-0000000000a1', (select mon from d) + 3, (select mon from d) + 6) = 1800 + 2 * 2200, 'Thu–Sun: ₱1,800 + Fri & Sat at ₱2,200 = ₱6,200');
select pg_temp.check(stay_price('b2000000-0000-0000-0000-0000000000a2', (select mon from d) + 4, (select mon from d) + 6) = 6000, 'no weekend rate → every night at the nightly rate');

set role anon;
create temp table s1 on commit preserve rows as select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 3, 6)) r;
reset role;
select pg_temp.check((select (r->>'nights')::int = 3 and (r->>'total')::numeric = 6200 and (r->>'deposit')::numeric = 1860 and r->>'booking_number' like 'ST-%' from s1), 'booked Thu–Sun: 3 nights, ₱6,200, deposit 30% = ₱1,860, number ST-…');
select pg_temp.check((select status = 'awaiting_deposit' and payment_status = 'for_verification' and terms_snapshot like 'Quiet hours%' from stay_bookings), 'new stay waits for the deposit check; the agreed terms are saved');

-- availability: 1 Garden room → overlapping nights refused; back-to-back (check-out day = next check-in) is fine
set role anon;
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 5, 7))$q$, 'UNAVAILABLE');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 1, 4))$q$, 'UNAVAILABLE');
select pg_temp.check((book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 6, 8))->>'nights')::int = 2, 'back-to-back stay: check in on the day the last guest checks out');
select pg_temp.check((book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 0, 3))->>'nights')::int = 3, 'and one ending the day the first begins');
select pg_temp.check((select count(*) from stay_full_nights('b2000000-0000-0000-0000-0000000000a1', (select mon from d), (select mon from d) + 10)) = 8, 'calendar: 8 fully booked nights (Mon–Mon), the rest free');
reset role;
update stay_bookings set status = 'cancelled', cancel_reason = 'Guest cancelled' where check_in = (select mon from d) + 6;
set role anon;
select pg_temp.check((book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 6, 7))->>'nights')::int = 1, 'a cancelled stay frees its nights');

-- units: 2 Family suites → two overlapping stays fit, a third is refused
select pg_temp.check((book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a2', 0, 2))->>'nights')::int = 2, 'units: first suite booked');
select pg_temp.check((book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a2', 1, 3))->>'nights')::int = 2, 'units: a second overlapping suite fits (2 units)');
select pg_temp.check((select count(*) from stay_full_nights('b2000000-0000-0000-0000-0000000000a2', (select mon from d), (select mon from d) + 4)) = 1, 'units: only the night both suites are taken shows as full');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a2', 1, 3))$q$, 'UNAVAILABLE');

-- rules
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a2', 10, 11))$q$, 'at least 2 nights');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"guests": 3}'))$q$, 'up to 2 guests');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 10))$q$, 'after check-in');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', -60, -58))$q$, 'past');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 50))$q$, 'up to 30 nights');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"id_photo_path": null}'))$q$, 'valid ID');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"id_photo_path": "licenses/2026/x.jpg"}'))$q$, 'valid ID');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"payment_proof_path": null}'))$q$, 'GCash');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"terms_agreed": false}'))$q$, 'agree');
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 10, 11, '{"customer_phone": "12345"}'))$q$, '09XXXXXXXXX');
reset role;
update stay_rooms set is_active = false where id = 'b2000000-0000-0000-0000-0000000000a1';
set role anon;
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 12, 13))$q$, 'choose a room');
reset role;
update stay_rooms set is_active = true where id = 'b2000000-0000-0000-0000-0000000000a1';

-- privacy: guests can't list bookings or write rooms; the status page only shows by secret token
set role anon;
select pg_temp.check((select count(*) from stay_bookings) = 0, 'guests can''t read anyone''s stays');
select pg_temp.check((select count(*) from stay_rooms where not is_active) = 0, 'guests don''t see hidden rooms');
select pg_temp.expect_error($q$insert into stay_bookings (room_id, room_name, property_name, customer_name, customer_phone, check_in, check_out, nights, guests, total, deposit_amount, id_photo_path) values ('b2000000-0000-0000-0000-0000000000a1','x','x','x','09171234567', current_date + 400, current_date + 401, 1, 1, 0, 0, 'x')$q$, 'row-level security');
update stay_rooms set nightly_rate = 1;
select pg_temp.check((select count(*) from stay_rooms where nightly_rate = 1) = 0, 'guests can''t change room prices');
select pg_temp.check((select get_stay_booking((select (r->>'token')::uuid from s1))->>'total')::numeric = 6200
  and (select get_stay_booking((select (r->>'token')::uuid from s1))->>'check_in_time') = '14:00:00'
  and get_stay_booking(gen_random_uuid()) is null, 'the booking page loads by secret link (with check-in time); a random link shows nothing');
reset role;

-- accounts required + inbox messages for the customer's stay
update store_settings set require_account = true;
set role anon;
select pg_temp.expect_error($q$select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 20, 22))$q$, 'SIGN_IN');
reset role;
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-0000000000b1', 'guest@t.test'), ('c0000000-0000-0000-0000-0000000000b2', 'other@t.test');
set role authenticated; select pg_temp.as_user('c0000000-0000-0000-0000-0000000000b1');
create temp table own on commit preserve rows as select book_stay(pg_temp.req('b2000000-0000-0000-0000-0000000000a1', 20, 22)) r;
select pg_temp.check((select count(*) from stay_bookings) = 1 and (select customer_user_id from stay_bookings) = 'c0000000-0000-0000-0000-0000000000b1', 'signed-in customer books; they see only their own stay');
select pg_temp.as_user('c0000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from stay_bookings) = 0, 'another customer can''t see it');
update stay_bookings set status = 'confirmed';
reset role; select pg_temp.as_user('');
select pg_temp.check((select status from stay_bookings where customer_user_id = 'c0000000-0000-0000-0000-0000000000b1') = 'awaiting_deposit', 'customers can''t confirm their own stay');
update stay_bookings set status = 'confirmed', payment_status = 'deposit_paid' where customer_user_id = 'c0000000-0000-0000-0000-0000000000b1';
select pg_temp.expect_error($q$update stay_bookings set status = 'cancelled' where customer_user_id = 'c0000000-0000-0000-0000-0000000000b1'$q$, 'check');
update stay_bookings set status = 'cancelled', cancel_reason = 'Guest cancelled', cancelled_at = now() where customer_user_id = 'c0000000-0000-0000-0000-0000000000b1';
update stay_bookings set payment_status = 'refunded' where customer_user_id = 'c0000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) from customer_messages where user_id = 'c0000000-0000-0000-0000-0000000000b1') = 4
  and exists (select 1 from customer_messages where title like 'Stay ST-% · confirmed' and body like 'Garden room,%' and link like '/stays/booking/%'),
  'stay messages: received, confirmed, cancelled, deposit refunded (with a link to the stay)');
select pg_temp.check((select count(*) from customer_messages where user_id <> 'c0000000-0000-0000-0000-0000000000b1') = 0, 'guest stays create no messages');
update store_settings set require_account = false;

select 'ALL STAY SCENARIOS PASSED';
