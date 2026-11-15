"use client";
import { useEffect, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { HubSearch, ListingRow } from "./HubParts";
import { CategoryCollage } from "./CategoryCards";
import { useHubListings } from "@/lib/hub";
import { WelcomeBanner } from "./WelcomeBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useFirstName } from "@/lib/use-first-name";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { getSupabase } from "@/lib/supabase/client";

/** Home: welcome banner → search → category collage (Food · Vehicle Rentals · Stays · Tours) → rows → your shortcuts. */
export function HomeChooser() {
  const { settings, open } = useStoreSettings();
  const cafe = brandOf(settings, "cafe");
  const t = welcomeTexts(settings);
  const firstName = useFirstName();
  const hub = useHubListings();
  const [minFee, setMinFee] = useState<number | null>(null);
  useEffect(() => {
    getSupabase().from("delivery_zones").select("fee").eq("is_active", true).order("fee").limit(1).then(({ data }) => setMinFee(data?.[0] ? Number(data[0].fee) : null));
  }, []);

  const menuPhoto = hub?.food.find((l) => l.photo && !l.badge)?.photo || null;
  const hero = settings?.hero_url || menuPhoto;

  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:py-8">
        {/* Welcome banner: exact colour if one is set in Settings, else the welcome photo */}
        <WelcomeBanner color={settings?.welcome_banner_color} textColor={settings?.welcome_banner_text_color} photo={hero} title={firstName ? `Welcome, ${firstName}!` : t.title} subtitle={t.subtitle} />

        <HubSearch hub={hub} pills={false} />

        {/* Food · Vehicle Rentals · Stays · Tours */}
        <CategoryCollage hub={hub} foodPhoto={settings?.home_cafe_bg_url || menuPhoto} />

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
          href="/explore?cat=rentals"
          listings={[...(hub?.cars ?? []), ...(hub?.scooters ?? [])]}
          testId="row-rentals"
        />
        {(hub?.stays.length ?? 0) > 0 && (
          <ListingRow title="Top stays" subtitle="Rooms and beach houses on Tablas — book with a deposit" href="/explore?cat=stays" listings={hub!.stays} testId="row-stays" />
        )}

        <HomeShortcuts />

        <InstallPrompt />
      </main>
    </div>
  );
}
