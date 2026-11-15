"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { HubSearch, ListingRow } from "./HubParts";
import { LocBar } from "./LocBar";
import { WelcomeBanner } from "./WelcomeBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { filterHub, minVehicleRate, useHubListings, type HubData } from "@/lib/hub";
import { ISLANDS, inLoc, islandOf, locLabel, useLoc } from "@/lib/romblon";
import { useFirstName } from "@/lib/use-first-name";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { getSupabase } from "@/lib/supabase/client";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Home: island / town filter → hero → Stays · Rentals · Food · Tours → search → Explore by island → our brands → rows. */
export function HomeChooser() {
  const { settings, open } = useStoreSettings();
  const t = welcomeTexts(settings);
  const firstName = useFirstName();
  const all = useHubListings();
  const [loc, setLoc] = useLoc();
  const hub = useMemo(() => filterHub(all, (town) => inLoc(loc, town)), [all, loc]);
  const where = locLabel(loc);
  const [minFee, setMinFee] = useState<number | null>(null);
  useEffect(() => {
    getSupabase().from("delivery_zones").select("fee").eq("is_active", true).order("fee").limit(1).then(({ data }) => setMinFee(data?.[0] ? Number(data[0].fee) : null));
  }, []);

  const menuPhoto = all?.food.find((l) => l.photo && !l.badge)?.photo || null;
  const hero = settings?.hero_url || menuPhoto;
  const nothingHere = !!hub && hub.food.length + hub.scooters.length + hub.cars.length + hub.stays.length === 0;

  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-4 sm:py-6">
        <LocBar />

        <WelcomeBanner
          color={settings?.welcome_banner_color}
          textColor={settings?.welcome_banner_text_color}
          photo={hero}
          eyebrow={firstName ? `👋 Welcome, ${firstName}!` : "📍 17 towns · 20 islands · one app"}
          title={t.title}
          subtitle={t.subtitle}
        />

        <CategoryCards hub={hub} minFee={minFee} />

        <HubSearch hub={hub} pills={false} />

        {nothingHere && (
          <section className="card p-6 text-center" data-testid="loc-empty">
            <p className="text-4xl" aria-hidden>
              🧭
            </p>
            <p className="mt-2 font-semibold">Nothing is listed in {where} yet.</p>
            <p className="text-sm text-coffee-700">More towns are coming as local businesses join Padaya.</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => setLoc({ island: "all", town: "all" })}>
              Show all of Romblon
            </button>
          </section>
        )}

        <IslandCards all={all} onPick={(id) => setLoc({ island: id, town: "all" })} current={loc.island} />

        <OurBrands hub={hub} />

        <ListingRow title={`Stays in ${where}`} subtitle="Rooms and beach houses — book with a deposit" href="/stays" listings={hub?.stays ?? []} testId="row-stays" />
        <ListingRow title="Get around" subtitle="Scooters and cars for exploring the islands" href="/explore?cat=rentals" listings={[...(hub?.scooters ?? []), ...(hub?.cars ?? [])]} testId="row-rentals" />
        <ListingRow
          title="Food delivery"
          subtitle={`Coffee, drinks and meals from ${brandOf(settings, "cafe").name}`}
          href="/explore?cat=food"
          listings={(hub?.food ?? []).filter((l) => l.photo && !l.badge).slice(0, 10)}
          testId="row-food"
        />
        <Link href="/tours" className="card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-md" data-testid="tours-teaser">
          <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
            🚤
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-bold">Island tours & activities</span>
            <span className="block text-sm text-coffee-700">Island hopping, waterfalls, snorkeling — coming soon. Get notified when they open.</span>
          </span>
          <span aria-hidden className="text-xl text-orange-700">
            →
          </span>
        </Link>

        <HomeShortcuts />

        <InstallPrompt />
      </main>
    </div>
  );
}

/** The four big category cards (like the upload): icon, name, how many in the chosen place, From-price. */
function CategoryCards({ hub, minFee }: { hub: HubData | null; minFee: number | null }) {
  const vRate = minVehicleRate(hub);
  const shops = hub ? new Set([...hub.scooters, ...hub.cars].map((l) => l.business)).size : 0;
  const stores = hub ? new Set(hub.food.map((l) => l.business)).size : 0;
  const places = hub?.properties.length ?? 0;
  const cards = [
    {
      id: "stays",
      href: "/stays",
      emoji: "🏝️",
      tint: "bg-orange-100",
      name: "Stays",
      count: hub ? (places ? plural(places, "place") : "Coming soon") : "",
      from: hub?.minStayRate != null ? `from ${formatPeso(hub.minStayRate)}/night` : null,
    },
    {
      id: "rentals",
      href: "/explore?cat=rentals",
      emoji: "🛵",
      tint: "bg-sky-100",
      name: "Rentals",
      count: hub ? (shops ? `${plural(shops, "shop")} · scooters & cars` : "None here yet") : "",
      from: vRate != null ? `from ${formatPeso(vRate)}/day` : null,
    },
    {
      id: "food",
      href: "/explore?cat=food",
      emoji: "🍜",
      tint: "bg-amber-100",
      name: "Food delivery",
      count: hub ? (stores ? plural(stores, "store") : "None here yet") : "",
      from: stores && minFee != null ? (minFee > 0 ? `from ${formatPeso(minFee)} delivery` : "free delivery nearby") : null,
    },
    { id: "tours", href: "/tours", emoji: "🚤", tint: "bg-rose-100", name: "Tours", count: "Coming soon", from: "Get notified" },
  ];
  return (
    <nav aria-label="Categories" className="-mt-2 grid grid-cols-2 gap-3" data-testid="home-categories">
      {cards.map((c) => (
        <Link
          key={c.id}
          href={c.href}
          data-testid={`cat-${c.id}`}
          className="flex flex-col gap-2 rounded-2xl border border-coffee-100 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-md sm:flex-row sm:items-center sm:gap-3 sm:p-4"
        >
          <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${c.tint}`}>
            {c.emoji}
          </span>
          <span className="min-w-0">
            <span className="block font-bold leading-tight text-coffee-900">{c.name}</span>
            {c.count && <span className="block text-xs text-coffee-600">{c.count}</span>}
            {c.from && <span className="block text-xs font-bold text-orange-700">{c.from}</span>}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** "Explore by island": tap an island to filter everything. Counts are listings on that island. */
function IslandCards({ all, onPick, current }: { all: HubData | null; onPick: (id: (typeof ISLANDS)[number]["id"]) => void; current: string }) {
  const count = (id: string) => (all ? [...all.food, ...all.scooters, ...all.cars, ...all.stays].filter((l) => islandOf(l.town) === id).length : 0);
  return (
    <section aria-labelledby="islands-title" data-testid="island-cards">
      <h2 id="islands-title" className="section-title">
        Explore by island
      </h2>
      <p className="mb-3 text-sm text-coffee-600">Tap an island to filter everything in the app.</p>
      <div className="grid grid-cols-2 gap-3">
        {ISLANDS.map((i, k) => {
          const n = count(i.id);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                onPick(i.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              aria-pressed={current === i.id}
              data-testid={`island-${i.id}`}
              className={`relative isolate flex min-h-[7.5rem] flex-col justify-end overflow-hidden rounded-2xl p-3 text-left text-white shadow-card transition hover:-translate-y-0.5 ${k === ISLANDS.length - 1 ? "col-span-2" : ""} ${current === i.id ? "ring-4 ring-orange-400" : ""}`}
              style={{ background: `linear-gradient(160deg, ${i.colors[0]} 0%, ${i.colors[1]} 100%)` }}
            >
              <svg aria-hidden viewBox="0 0 200 60" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 w-full opacity-40">
                <path d="M0 40 Q30 10 60 30 T120 22 T200 30 V60 H0Z" fill="#fff" />
              </svg>
              <span className="font-display text-lg font-bold leading-tight drop-shadow">{i.name}</span>
              <span className="text-xs text-white/90 drop-shadow">{i.sub}</span>
              <span className="mt-1 text-xs font-bold text-white drop-shadow">{n ? `${plural(n, "listing")}` : "Coming soon"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const BRAND_LINK: Record<string, { href: string; emoji: string; what: string }> = {
  "pahuway-cafe": { href: "/menu", emoji: "☕", what: "Coffee & food delivery" },
  baybayin: { href: "/baybayin", emoji: "🛵", what: "Scooter & car rentals" },
  "padaya-stays": { href: "/stays", emoji: "🏠", what: "Stays" },
  "padaya-tours": { href: "/tours", emoji: "🚤", what: "Tours" },
};

/** Our brands (the upload's "Founding partners"): the businesses with listings in the chosen place. */
function OurBrands({ hub }: { hub: HubData | null }) {
  const { settings } = useStoreSettings();
  if (!hub) return null;
  const active = new Set([...hub.food, ...hub.scooters, ...hub.cars, ...hub.stays].map((l) => l.business));
  const list = hub.businesses.filter((b) => active.has(b.slug));
  if (!list.length) return null;
  const logo = (slug: string) => (slug === "pahuway-cafe" ? brandOf(settings, "cafe").logo : slug === "baybayin" ? brandOf(settings, "baybayin").logo : null);
  return (
    <section aria-labelledby="brands-title" data-testid="our-brands">
      <h2 id="brands-title" className="section-title">
        Our brands
      </h2>
      <p className="mb-3 text-sm text-coffee-600">Local businesses you can book on Padaya.</p>
      <div className="grid grid-cols-2 gap-3">
        {list.map((b) => {
          const l = BRAND_LINK[b.slug] ?? { href: "/explore", emoji: "🏪", what: b.kind };
          const src = logo(b.slug);
          return (
            <Link key={b.id} href={l.href} data-testid={`brand-${b.slug}`} className="flex items-center gap-3 rounded-2xl border border-coffee-100 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-md">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
              ) : (
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-2xl">
                  {l.emoji}
                </span>
              )}
              <span className="min-w-0">
                <span className="block font-bold leading-tight text-coffee-900">{b.slug === "pahuway-cafe" ? brandOf(settings, "cafe").name : b.slug === "baybayin" ? brandOf(settings, "baybayin").name : b.name}</span>
                <span className="block text-xs text-coffee-600">
                  {l.what} · {b.town}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
