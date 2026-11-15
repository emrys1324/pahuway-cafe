"use client";
import { HOME_CARD_DEFAULTS, HomeCard } from "./HomeCard";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { bookingsOpen, useRentalSettings } from "@/lib/rentals";

/** "Order food & drinks" — the café card, shown at the top of the Food category. */
export function FoodCard() {
  const { settings, open } = useStoreSettings();
  const { count } = useCart();
  const cafe = brandOf(settings, "cafe");
  const t = welcomeTexts(settings);
  const status = !settings
    ? "See the menu"
    : open
      ? `Open now · until ${formatClock(settings.close_time)}`
      : settings.is_open
        ? `Closed now · opens ${formatClock(settings.open_time)}`
        : "Closed for now";
  return (
    <HomeCard
      href="/menu"
      testId="choose-cafe"
      color={settings?.home_cafe_color}
      textColor={settings?.home_cafe_text_color}
      fallbackColor={HOME_CARD_DEFAULTS.cafe}
      bgUrl={settings?.home_cafe_bg_url}
      logo={settings?.home_cafe_logo_url || cafe.logo}
      emoji="☕"
      title="Order food & drinks"
      text={t.cafeCard}
      status={count > 0 ? `${count} item${count === 1 ? "" : "s"} in cart` : status}
    />
  );
}

/** "Book a scooter" — the Baybayin card, shown at the top of Vehicle Rentals. */
export function ScooterCard({ minRate }: { minRate: number | null }) {
  const { settings } = useStoreSettings();
  const rs = useRentalSettings();
  const bay = brandOf(settings, "baybayin");
  const t = welcomeTexts(settings);
  const rentOpen = !!rs && bookingsOpen(rs);
  return (
    <HomeCard
      href="/baybayin"
      testId="choose-scooter"
      color={settings?.home_bay_color}
      textColor={settings?.home_bay_text_color}
      fallbackColor={HOME_CARD_DEFAULTS.bay}
      bgUrl={settings?.home_bay_bg_url}
      logo={settings?.home_bay_logo_url || bay.logo}
      logoTestId="baybayin-logo"
      emoji={bay.emoji}
      title={rentOpen ? "Book a scooter" : "Scooter rentals"}
      text={t.baybayinCard}
      status={rs ? (rentOpen ? (minRate ? `Book now · from ${formatPeso(minRate)}/day` : "Book now") : "Coming soon") : bay.name}
    />
  );
}
