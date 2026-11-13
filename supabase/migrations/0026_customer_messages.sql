-- Customer inbox ("Messages" tab): automatic updates about the customer's own orders and scooter bookings.
-- Rows are written only by the triggers below (security definer); customers read their own and mark them read.

create table if not exists public.customer_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  title       text not null,
  body        text,
  link        text,                       -- page to open, e.g. /order/<token>
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists customer_messages_user on public.customer_messages (user_id, created_at desc);

alter table public.customer_messages enable row level security;
drop policy if exists "messages own read" on public.customer_messages;
create policy "messages own read" on public.customer_messages for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policies: customers can't write rows; read receipts go through mark_messages_read()

create or replace function public.mark_messages_read() returns void
language sql security definer set search_path = public as $$
  update public.customer_messages set read_at = now() where user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_messages_read() from public, anon;
grant execute on function public.mark_messages_read() to authenticated;

-- ---- café orders
create or replace function public.order_customer_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body  text;
begin
  if new.customer_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_title := 'Order ' || new.order_number || ' received';
    v_body  := 'Thanks! We''ve got your order and will start on it soon.';
  elsif new.status is distinct from old.status then
    v_title := 'Order ' || new.order_number || ' · ' || case new.status
      when 'preparing'        then 'being prepared'
      when 'ready'            then case when new.order_type = 'delivery' then 'packed, waiting for the rider' else 'ready' end
      when 'out_for_delivery' then 'on the way'
      when 'completed'        then case when new.order_type = 'delivery' then 'delivered' else 'completed' end
      when 'cancelled'        then 'cancelled'
      else new.status::text end;
    v_body := case new.status
      when 'preparing'        then 'Our barista is on it.'
      when 'ready'            then case when new.order_type = 'delivery' then 'Your rider will pick it up shortly.'
                                        when new.order_type = 'dine_in' then 'We''ll bring it to your table.'
                                        else 'Come pick it up at the counter.' end
      when 'out_for_delivery' then 'Your rider is heading your way.'
      when 'completed'        then 'Enjoy! Thank you for ordering.'
      when 'cancelled'        then 'Sorry — this order was cancelled. Message us if you have questions.'
      else null end;
  elsif new.payment_status is distinct from old.payment_status and new.payment_status = 'paid' and new.payment_method = 'gcash' then
    v_title := 'Order ' || new.order_number || ' · GCash payment verified';
    v_body  := 'Thanks — your payment is confirmed.';
  elsif new.payment_status is distinct from old.payment_status and new.payment_status = 'refunded' then
    v_title := 'Order ' || new.order_number || ' · refunded';
    v_body  := 'Your payment has been refunded.';
  else
    return new;
  end if;
  insert into public.customer_messages (user_id, title, body, link)
  values (new.customer_id, v_title, v_body, '/order/' || new.public_token);
  return new;
end $$;

drop trigger if exists orders_customer_message on public.orders;
create trigger orders_customer_message
  after insert or update of status, payment_status on public.orders
  for each row execute function public.order_customer_message();

-- ---- scooter bookings
create or replace function public.booking_customer_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body  text;
begin
  if new.customer_user_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_title := 'Booking ' || new.booking_number || ' received';
    v_body  := 'We''re checking your deposit. You''ll get a message once it''s confirmed.';
  elsif new.status is distinct from old.status then
    v_title := 'Booking ' || new.booking_number || ' · ' || case new.status
      when 'confirmed' then 'confirmed'
      when 'picked_up' then 'enjoy your ride'
      when 'returned'  then 'returned'
      when 'cancelled' then 'cancelled'
      else new.status end;
    v_body := case new.status
      when 'confirmed' then 'Your ' || new.scooter_name || ' is reserved. Show your booking page at pickup.'
      when 'picked_up' then 'Ride safe and have fun!'
      when 'returned'  then 'Thanks for riding with us.'
      when 'cancelled' then 'Sorry — this booking was cancelled. Message us if you have questions.'
      else null end;
  elsif new.payment_status is distinct from old.payment_status and new.payment_status = 'refunded' then
    v_title := 'Booking ' || new.booking_number || ' · deposit refunded';
    v_body  := 'Your deposit has been sent back.';
  else
    return new;
  end if;
  insert into public.customer_messages (user_id, title, body, link)
  values (new.customer_user_id, v_title, v_body, '/baybayin/booking/' || new.public_token);
  return new;
end $$;

drop trigger if exists bookings_customer_message on public.rental_bookings;
create trigger bookings_customer_message
  after insert or update of status, payment_status on public.rental_bookings
  for each row execute function public.booking_customer_message();

-- live unread badge
do $$ begin
  alter publication supabase_realtime add table public.customer_messages;
exception when duplicate_object then null; end $$;
