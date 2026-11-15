"use client";
import Link from "next/link";
import { HOME_CARD_DEFAULTS, HomeCard } from "./HomeCard";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { bookingsOpen, useRentalSettings } from "@/lib/rentals";
import { hubCategories, minVehicleRate, type HubData } from "@/lib/hub";

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

const TOURS_BG = "linear-gradient(135deg, #0e7490 0%, #1e3a5f 100%)";

/** Home: a photo collage of the four categories — Food (tall), Vehicle Rentals, Stays, Tours (wide). */
export function CategoryCollage({ hub, foodPhoto }: { hub: HubData | null; foodPhoto: string | null }) {
  const { settings } = useStoreSettings();
  const cats = Object.fromEntries(hubCategories(hub).map((c) => [c.id, c]));
  const vRate = minVehicleRate(hub);
  const tiles = [
    {
      id: "food",
      photo: foodPhoto,
      fallback: "linear-gradient(135deg, #c2410c 0%, #7c2d12 100%)",
      sub: hub?.minFood != null ? `From ${formatPeso(hub.minFood)}` : "Coffee, drinks & meals",
      cls: "row-span-2 min-h-[18rem] sm:min-h-[22rem]",
    },
    {
      id: "rentals",
      photo: settings?.home_bay_bg_url || hub?.scooters.find((l) => l.photo)?.photo || hub?.cars.find((l) => l.photo)?.photo || null,
      fallback: "linear-gradient(135deg, #0369a1 0%, #1e3a5f 100%)",
      sub: vRate != null ? `Scooters & cars · from ${formatPeso(vRate)}/day` : "Scooters & cars",
      cls: "min-h-[8.5rem] sm:min-h-[10.5rem]",
    },
    {
      id: "stays",
      photo: hub?.stays.find((l) => l.photo)?.photo ?? null,
      fallback: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
      sub: cats.stays?.soon ? "Coming soon" : hub?.minStayRate != null ? `From ${formatPeso(hub.minStayRate)}/night` : "Rooms & houses",
      cls: "min-h-[8.5rem] sm:min-h-[10.5rem]",
    },
    { id: "tours", photo: null, fallback: TOURS_BG, sub: "Coming soon", cls: "col-span-2 min-h-[6.5rem]" },
  ];
  return (
    <nav aria-label="Categories" className="grid grid-cols-2 gap-3" data-testid="home-collage">
      {tiles.map((t) => {
        const c = cats[t.id];
        const soon = t.sub === "Coming soon";
        return (
          <Link
            key={t.id}
            href={`/explore?cat=${t.id}`}
            data-testid={`collage-${t.id}`}
            className={`group relative isolate flex flex-col justify-end overflow-hidden rounded-3xl p-4 text-white shadow-lg transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coffee-800 ${t.cls}`}
            style={{ background: t.photo ? undefined : t.fallback }}
          >
            {t.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.photo} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            )}
            <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
            <span aria-hidden className="absolute right-3 top-3 text-3xl drop-shadow sm:text-4xl">
              {c.emoji}
            </span>
            <span className="font-display text-xl font-bold leading-tight drop-shadow sm:text-2xl">{c.label}</span>
            {soon ? (
              <span className="mt-1 w-fit rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-bold text-coffee-800">Coming soon</span>
            ) : (
              <span className="text-sm font-semibold text-white/90 drop-shadow">{t.sub}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
