-- Home page cards ("Order food & drinks" / "Book a scooter"): editable colour, logo and optional background photo.
-- All optional; empty = the built-in look (café brown / Baybayin blue, the brand logo, no photo).
alter table public.store_settings
  add column if not exists home_cafe_color    text,
  add column if not exists home_cafe_logo_url text,
  add column if not exists home_cafe_bg_url   text,
  add column if not exists home_bay_color     text,
  add column if not exists home_bay_logo_url  text,
  add column if not exists home_bay_bg_url    text;
alter table public.store_settings drop constraint if exists home_card_colours_hex;
alter table public.store_settings add constraint home_card_colours_hex check (
  (home_cafe_color is null or home_cafe_color ~ '^#[0-9a-fA-F]{6}$') and
  (home_bay_color  is null or home_bay_color  ~ '^#[0-9a-fA-F]{6}$'));
