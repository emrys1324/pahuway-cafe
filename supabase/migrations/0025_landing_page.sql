-- Welcome (landing) page: a hero photo and where to find us. All optional; empty = sensible fallbacks
-- (the hero uses a menu photo; the location line is hidden).
alter table public.store_settings
  add column if not exists hero_url          text,
  add column if not exists location_text     text check (location_text is null or length(location_text) <= 160),
  add column if not exists location_map_url  text check (location_map_url is null or location_map_url ~ '^https://');
