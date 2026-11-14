"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { HOME_CARD_DEFAULTS, HomeCard } from "./HomeCard";
import { WelcomeBanner } from "./WelcomeBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Badge } from "@/components/ui";
import { useFirstName } from "@/lib/use-first-name";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { formatPeso } from "@/lib/format";
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
  const [scooters, setScooters] = useState<Thumb[]>([]);

  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [minFee, setMinFee] = useState<number | null>(null);
  const [minRate, setMinRate] = useState<number | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    sb.from("menu_categories").select("id, name").eq("is_active", true).order("sort_order").then(({ data }) => setCats((data as { id: string; name: string }[]) ?? []));
    sb.from("delivery_zones").select("fee").eq("is_active", true).order("fee").limit(1).then(({ data }) => setMinFee(data?.[0] ? Number(data[0].fee) : null));
    sb.from("scooters").select("daily_rate").eq("is_active", true).order("daily_rate").limit(1).then(({ data }) => setMinRate(data?.[0] ? Number(data[0].daily_rate) : null));
  }, []);

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
      .limit(4)
      .then(({ data }) => setFood((data as Thumb[]) ?? []));
    supabase
      .from("scooters")
      .select("id, name, photo_url")
      .eq("is_active", true)
      .not("photo_url", "is", null)
      .order("sort_order")
      .order("name")
      .limit(4)
      .then(({ data }) => setScooters((data as Thumb[]) ?? []));
  }, []);

  const hero = settings?.hero_url || food[0]?.photo_url || null;
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

        {/* What are you craving? — category shortcuts into the menu */}
        {cats.length > 0 && (
          <section aria-labelledby="crave-title" data-testid="cravings">
            <h2 id="crave-title" className="section-title mb-2">
              What are you craving?
            </h2>
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {cats.slice(0, 10).map((c) => (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={`/menu#cat-${c.id}`}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-orange-200 bg-white px-4 font-semibold text-coffee-800 shadow-sm transition hover:border-orange-400 hover:bg-orange-50"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <HomeShortcuts />

        {/* Preview cards with photos */}
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Pahuway Cafe and Baybayin" data-testid="preview-cards">
          <li>
            <Link href="/menu" data-testid="preview-cafe" className="card group flex h-full flex-col overflow-hidden transition hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-coffee-700">
              <PhotoStrip photos={food.slice(0, 4)} testId="cafe-photos" />
              <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cafe.logo ?? undefined} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-cream object-cover" />
                  <span className="font-display text-xl font-bold leading-snug">Order from {cafe.name}</span>
                </div>
                {t.cafeCard && <span className="text-coffee-700">{t.cafeCard}</span>}
                {cafeStatus && <span className={`text-sm font-semibold ${cafeStatus.tone}`}>{cafeStatus.text}</span>}
                {count > 0 && (
                  <span className="text-sm font-semibold text-coffee-800">
                    Continue your order · {count} item{count === 1 ? "" : "s"} in cart
                  </span>
                )}
                <span className="btn-primary mt-auto w-full">{count > 0 ? "Continue order →" : "See the menu →"}</span>
              </div>
            </Link>
          </li>
          <li>
            <Link href="/baybayin" data-testid="preview-scooter" className="card group flex h-full flex-col overflow-hidden transition hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-coffee-700">
              <PhotoStrip photos={scooters} testId="scooter-photos" />
              <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  {bay.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bay.logo} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-white object-contain p-1" />
                  ) : (
                    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-3xl">
                      {bay.emoji}
                    </span>
                  )}
                  <span className="font-display text-xl font-bold leading-snug">Rent a scooter from {bay.name}</span>
                </div>
                {rs && <span>{rentOpen ? <Badge tone="amber">Book now{minRate ? ` · from ${formatPeso(minRate)}/day` : ""}</Badge> : <Badge tone="amber">Coming soon</Badge>}</span>}
                {t.baybayinCard && <span className="text-coffee-700">{t.baybayinCard}</span>}
                <span className="btn-primary mt-auto w-full">{rentOpen ? "Book a scooter →" : "Learn more →"}</span>
              </div>
            </Link>
          </li>
        </ul>


        <InstallPrompt />
      </main>
    </div>
  );
}

/** Up to 4 square photos across the top of a service card (hidden when there are none). */
function PhotoStrip({ photos, testId }: { photos: Thumb[]; testId: string }) {
  if (photos.length === 0) return null;
  return (
    <div data-testid={testId} className="grid h-28 gap-0.5 bg-coffee-100 sm:h-32" style={{ gridTemplateColumns: `repeat(${Math.min(4, photos.length)}, minmax(0, 1fr))` }}>
      {photos.slice(0, 4).map((p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={p.id} src={p.photo_url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
      ))}
    </div>
  );
}
