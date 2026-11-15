-- Scenario tests for 0034: towns on businesses / stay properties, and Tours "Notify me" sign-ups.
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
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- towns
select pg_temp.check(array_length(romblon_towns(), 1) = 17, 'the 17 towns of Romblon');
select pg_temp.check((select bool_and(town = 'San Agustin') from businesses) and (select bool_and(town = 'San Agustin') from stay_properties), 'existing businesses and stays default to San Agustin');
select pg_temp.check((select slug from businesses where kind = 'tours') = 'padaya-tours', 'Padaya Tours business added');
update stay_properties set town = 'Looc';
select pg_temp.check((select town from stay_properties limit 1) = 'Looc', 'a property can move to another town');
select pg_temp.expect_error($q$update stay_properties set town = 'Manila'$q$, 'stay_properties_town_valid');
select pg_temp.expect_error($q$update businesses set town = 'Boracay'$q$, 'businesses_town_valid');

-- notify me: guests
set role anon;
select pg_temp.check((tour_notify('{"name": "Tess Tour", "phone": "0917 555 0100", "interests": ["Island hopping", "Waterfalls & hikes"], "group_size": "4"}')->>'new')::boolean, 'a guest signs up for tour news');
select pg_temp.check(tour_signup_count() = 1, 'anyone can see how many are waiting (no details)');
select pg_temp.check((select count(*) from tour_signups) = 0, 'guests can''t read the list');
select pg_temp.check(not (tour_notify('{"name": "Tess T.", "phone": "+639175550100", "interests": ["Food & culture"]}')->>'new')::boolean, 'the same number again updates the sign-up (no duplicate)');
select pg_temp.expect_error($q$select tour_notify('{"name": "X", "phone": "09175550101"}')$q$, 'name');
select pg_temp.expect_error($q$select tour_notify('{"name": "Xavi", "phone": "12345"}')$q$, '09XXXXXXXXX');
select pg_temp.expect_error($q$select tour_notify('{"name": "Xavi", "phone": "09175550101", "interests": ["Bungee"]}')$q$, 'tour ideas');
select pg_temp.expect_error($q$select tour_notify('{"name": "Xavi", "phone": "09175550101", "group_size": 80}')$q$, '1 to 50');
select pg_temp.expect_error($q$insert into tour_signups (name, phone) values ('Direct', '09175550102')$q$, 'row-level security');
reset role;
select pg_temp.check((select name || '|' || array_to_string(interests, ',') || '|' || coalesce(group_size::text, '-') from tour_signups) = 'Tess T.|Food & culture|-', 'stored once, with the latest name and picks');

-- signed-in customers: linked to the account, a welcome message once, can see their own
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-0000000000d1', 'tour@t.test');
set role authenticated; select pg_temp.as_user('c0000000-0000-0000-0000-0000000000d1');
select tour_notify('{"name": "Dina", "phone": "09175550103", "interests": ["Island hopping"]}');
select tour_notify('{"name": "Dina", "phone": "09175550103", "interests": ["Island hopping", "Snorkeling & diving"]}');
select pg_temp.check((select count(*) from tour_signups) = 1 and (select array_length(interests, 1) from tour_signups) = 2, 'a signed-in customer sees only their own sign-up');
select pg_temp.check((select count(*) from customer_messages where title like 'You''re on the Tours list%' and link = '/tours') = 1, 'they get one "You''re on the Tours list" message (not again on update)');
reset role; select pg_temp.as_user('');

select 'ALL TOUR SCENARIOS PASSED';
