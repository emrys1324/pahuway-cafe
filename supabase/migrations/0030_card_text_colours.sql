-- Editable text colour for the welcome banner and the two Home cards. Empty = automatic (white or dark,
-- whichever reads better on the background).
alter table public.store_settings
  add column if not exists welcome_banner_text_color text,
  add column if not exists home_cafe_text_color      text,
  add column if not exists home_bay_text_color       text;
alter table public.store_settings drop constraint if exists text_colours_hex;
alter table public.store_settings add constraint text_colours_hex check (
  (welcome_banner_text_color is null or welcome_banner_text_color ~ '^#[0-9a-fA-F]{6}$') and
  (home_cafe_text_color      is null or home_cafe_text_color      ~ '^#[0-9a-fA-F]{6}$') and
  (home_bay_text_color       is null or home_bay_text_color       ~ '^#[0-9a-fA-F]{6}$'));
