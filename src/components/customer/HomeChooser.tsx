"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { HubSearch, ListingRow } from "./HubParts";
import { HUB_CATEGORIES, useHubListings } from "@/lib/hub";
import { HOME_CARD_DEFAULTS, HomeCard } from "./HomeCard";
import { WelcomeBanner } from "./WelcomeBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useFirstName } from "@/lib/use-first-name";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { getSupabase } from "@/lib/supabase/client";
import { bookingsOpen, useRentalSettings } from "@/lib/rentals";


/** Home (landing page): welcome header, the two main cards, your shortcuts, no extra info cards. */
export function HomeChooser() {
  const { settings, open } = useStoreSettings();
  const { count } = useCart();
  const cafe = brandOf(settings, "cafe");
  const bay = brandOf(settings, "baybayin");
  const t = welcomeTexts(settings);
  const rs = useRentalSettings();
  const firstName = useFirstName();
  const hub = useHubListings();
  const [minFee, setMinFee] = useState<number | null>(null);
  useEffect(() => {
    getSupabase().from("delivery_zones").select("fee").eq("is_active", true).order("fee").limit(1).then(({ data }) => setMinFee(data?.[0] ? Number(data[0].fee) : null));
  }, []);
  const minRate = hub?.minRate ?? null;

  const hero = settings?.hero_url || hub?.food.find((l) => l.photo && !l.badge)?.photo || null;
  const rentOpen = !!rs && bookingsOpen(rs);

  const cafeStatus = !settings
    ? null
    : open
      ? { tone: "text-orange-700", text: `Open now · until ${formatClock(settings.close_time)}` }
      : settings.is_open
        ? { tone: "text-coffee-700", text: `Closed now · opens ${formatClock(settings.open_time)}` }
        : { tone: "text-coffee-700", text: "Closed for now" };


  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:py-8">
        {/* Welcome banner: exact colour if one is set in Settings, else the welcome photo */}
        <WelcomeBanner color={settings?.welcome_banner_color} textColor={settings?.welcome_banner_text_color} photo={hero} title={firstName ? `Welcome, ${firstName}!` : t.title} subtitle={t.subtitle} />

        {/* The two main actions, right under the welcome header */}
        <nav aria-label="What would you like to do?" className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="main-actions">
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
            status={count > 0 ? `${count} item${count === 1 ? "" : "s"} in cart` : cafeStatus?.text ?? "See the menu"}
          />
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
        </nav>

        <HubSearch />

        {/* Quick facts, like a delivery app's info strip */}
        <ul className="-mt-1 flex flex-wrap gap-2 text-sm" aria-label="Good to know" data-testid="info-strip">
          {minFee !== null && (
            <li className="rounded-full bg-orange-50 px-3 py-1.5 font-semibold text-orange-800 ring-1 ring-orange-200">
              🛵 {minFee > 0 ? `Delivery from ${formatPeso(minFee)}` : "Free delivery nearby"}
            </li>
          )}
          {settings && (
            <li className="rounded-full bg-orange-50 px-3 py-1.5 font-semibold text-orange-800 ring-1 ring-orange-200">⏱ Ready in ~{settings.prep_minutes} min</li>
          )}
        </ul>

        {/* What are you planning? — one tile per category, with a From-price */}
        <section aria-labelledby="plan-title" data-testid="plan-tiles">
          <h2 id="plan-title" className="section-title mb-3">
            What are you planning?
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
            {HUB_CATEGORIES.map((c) => {
              const from = c.id === "food" ? hub?.minFood : c.id === "scooters" ? hub?.minRate : null;
              return (
                <li key={c.id}>
                  <Link
                    href={`/explore?cat=${c.id}`}
                    data-testid={`tile-${c.id}`}
                    className={`flex h-full flex-col items-center gap-1 rounded-2xl border p-3 text-center transition hover:-translate-y-0.5 hover:shadow-md ${c.soon ? "border-coffee-100 bg-white/60" : "border-orange-200 bg-white"}`}
                  >
                    <span aria-hidden className="text-3xl">
                      {c.emoji}
                    </span>
                    <span className="font-bold text-coffee-900">{c.label}</span>
                    {c.soon ? (
                      <span className="rounded-full bg-coffee-100 px-2 py-0.5 text-xs font-bold text-coffee-700">Coming soon</span>
                    ) : (
                      from != null && <span className="text-xs font-semibold text-orange-700">From {formatPeso(from)}{c.id === "scooters" ? "/day" : ""}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <ListingRow
          title="Popular on the menu"
          subtitle={`Coffee, drinks and food from ${cafe.name}`}
          href="/explore?cat=food"
          listings={(hub?.food ?? []).filter((l) => l.photo && !l.badge).slice(0, 10)}
          testId="row-food"
        />
        <ListingRow
          title="Scooters and car rentals"
          subtitle="The easiest way to get around Tablas"
          href="/explore?cat=scooters"
          listings={hub?.scooters ?? []}
          testId="row-rentals"
        />
        <section className="card flex items-center gap-4 p-4" data-testid="stays-teaser">
          <span aria-hidden className="text-4xl">
            🏝️
          </span>
          <div>
            <p className="font-bold">Stays and tours are coming soon</p>
            <p className="text-sm text-coffee-700">Beach houses, rooms and island tours — book them right here in Padaya.</p>
          </div>
        </section>

        <HomeShortcuts />

        <InstallPrompt />
      </main>
    </div>
  );
}
