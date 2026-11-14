-- Welcome banner colour: when set, the banner on the welcome page is this exact colour (no photo, no darkening);
-- the text turns white or dark automatically. Empty = the welcome photo as before.
alter table public.store_settings add column if not exists welcome_banner_color text;
alter table public.store_settings drop constraint if exists welcome_banner_color_hex;
alter table public.store_settings add constraint welcome_banner_color_hex
  check (welcome_banner_color is null or welcome_banner_color ~ '^#[0-9a-fA-F]{6}$');
