"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { HOME_CARD_DEFAULTS, HomeCard } from "./HomeCard";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useFirstName } from "@/lib/use-first-name";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { getSupabase } from "@/lib/supabase/client";
import { bookingsOpen, useRentalSettings } from "@/lib/rentals";

type Thumb = { id: string; name: string; photo_url: string };

/** Home (landing page): welcome header, the two main cards, your shortcuts, no extra info cards. */
export function HomeChooser() {
  const { settings, open } = useStoreSettings();
  const { count } = useCart();
  const cafe = brandOf(settings, "cafe");
  const bay = brandOf(settings, "baybayin");
  const t = welcomeTexts(settings);
  const rs = useRentalSettings();
  const firstName = useFirstName();
  const [food, setFood] = useState<Thumb[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from("menu_items")
      .select("id, name, photo_url")
      .eq("is_active", true)
      .eq("is_sold_out", false)
      .not("photo_url", "is", null)
      .order("sort_order")
      .order("name")
      .limit(1)
      .then(({ data }) => setFood((data as Thumb[]) ?? []));
  }, []);

  const hero = settings?.hero_url || food[0]?.photo_url || null;
  const rentOpen = !!rs && bookingsOpen(rs);

  const cafeStatus = !settings
    ? null
    : open
      ? { tone: "text-sage-700", text: `Open now · until ${formatClock(settings.close_time)}` }
      : settings.is_open
        ? { tone: "text-coffee-700", text: `Closed now · opens ${formatClock(settings.open_time)}` }
        : { tone: "text-coffee-700", text: "Closed for now" };


  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:py-8">
        {/* Hero */}
        <section data-testid="hero" className="relative isolate overflow-hidden rounded-3xl bg-coffee-900 text-white shadow-lg">
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt="" data-testid="hero-photo" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          )}
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/50 to-black/20" />
          <div className="flex min-h-[110px] flex-col justify-end gap-1 px-5 py-4 sm:min-h-[140px] sm:px-8 sm:py-5">
            <div>
              <h1 data-testid="welcome-title" className="font-display text-3xl font-bold leading-tight drop-shadow sm:text-4xl">
                {firstName ? `Welcome, ${firstName}!` : t.title}
              </h1>
              {t.subtitle && (
                <p data-testid="welcome-subtitle" className="text-base text-white/90 drop-shadow sm:text-lg">
                  {t.subtitle}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* The two main actions, right under the welcome header */}
        <nav aria-label="What would you like to do?" className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="main-actions">
          <HomeCard
            href="/menu"
            testId="choose-cafe"
            color={settings?.home_cafe_color}
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
            fallbackColor={HOME_CARD_DEFAULTS.bay}
            bgUrl={settings?.home_bay_bg_url}
            logo={settings?.home_bay_logo_url || bay.logo}
            logoTestId="baybayin-logo"
            emoji={bay.emoji}
            title={rentOpen ? "Book a scooter" : "Scooter rentals"}
            text={t.baybayinCard}
            status={rs ? (rentOpen ? "Book now" : "Coming soon") : bay.name}
          />
        </nav>

        <HomeShortcuts />

        <InstallPrompt />
      </main>
    </div>
  );
}
