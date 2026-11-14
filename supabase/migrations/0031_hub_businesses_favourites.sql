-- Padaya 2.0 (hub) groundwork:
-- 1) businesses: every listing belongs to a business. Today all are yours (Pahuway Cafe, Baybayin);
--    later partner businesses can be added without changing the listings.
-- 2) favourites: customers save listings (♡) — menu items and scooters now, cars/stays later.

create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null,
  kind        text not null check (kind in ('food', 'rentals', 'stays', 'tours')),
  is_active   boolean not null default true,
  owner_id    uuid references public.users (id) on delete set null,  -- null = the Padaya team (you)
  created_at  timestamptz not null default now()
);
alter table public.businesses enable row level security;
drop policy if exists "businesses public read" on public.businesses;
create policy "businesses public read" on public.businesses for select using (is_active or public.is_admin());
drop policy if exists "businesses admin write" on public.businesses;
create policy "businesses admin write" on public.businesses for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.businesses (slug, name, kind) values
  ('pahuway-cafe', 'Pahuway Cafe', 'food'),
  ('baybayin', 'Baybayin', 'rentals')
on conflict (slug) do nothing;

alter table public.scooters add column if not exists business_id uuid references public.businesses (id);
update public.scooters set business_id = (select id from public.businesses where slug = 'baybayin') where business_id is null;
alter table public.menu_items add column if not exists business_id uuid references public.businesses (id);
update public.menu_items set business_id = (select id from public.businesses where slug = 'pahuway-cafe') where business_id is null;

create table if not exists public.favourites (
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        text not null check (kind in ('menu_item', 'scooter', 'car', 'stay', 'tour')),
  item_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);
alter table public.favourites enable row level security;
drop policy if exists "favourites own" on public.favourites;
create policy "favourites own" on public.favourites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- new scooters / menu items added later belong to Baybayin / Pahuway Cafe unless set otherwise
create or replace function public.default_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is null then
    new.business_id := (select id from public.businesses where slug = case tg_table_name when 'scooters' then 'baybayin' else 'pahuway-cafe' end);
  end if;
  return new;
end $$;
drop trigger if exists scooters_default_business on public.scooters;
create trigger scooters_default_business before insert on public.scooters for each row execute function public.default_business();
drop trigger if exists menu_items_default_business on public.menu_items;
create trigger menu_items_default_business before insert on public.menu_items for each row execute function public.default_business();
update public.scooters set business_id = (select id from public.businesses where slug = 'baybayin') where business_id is null;
update public.menu_items set business_id = (select id from public.businesses where slug = 'pahuway-cafe') where business_id is null;
