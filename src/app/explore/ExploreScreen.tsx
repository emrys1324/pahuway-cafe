"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { LocBar } from "@/components/customer/LocBar";
import { inLoc, locLabel, useLoc } from "@/lib/romblon";
import { StoreHeader } from "@/components/customer/Header";
import { HubSearch } from "@/components/customer/HubParts";
import { ListingCard } from "@/components/customer/ListingCard";
import { PageLoader } from "@/components/ui";
import { useFavourites } from "@/lib/favourites";
import { FoodCard, ScooterCard } from "@/components/customer/CategoryCards";
import { filterHub, hubCategories, useHubListings, type HubCategory, type RentalType } from "@/lib/hub";
import { useStoreSettings } from "@/lib/store-settings";

type Filter = "all" | HubCategory | "saved";
const SOON: Record<string, string> = {
  cars: "Car rentals are coming soon — self-drive or with a driver, booked right here.",
  stays: "Stays are coming soon — beach houses and rooms on Tablas, with instant booking.",
  tours: "Tours are coming soon — island hopping, waterfalls and more with local guides.",
};

/** Explore: search everything bookable on Padaya, filter by category, and see saved (♡) listings. */
export function ExploreScreen() {
  const { settings, open } = useStoreSettings();
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const rawCat = params.get("cat") ?? (params.get("saved") ? "saved" : "all");
  // old links: ?cat=scooters / ?cat=cars → Vehicle Rentals with that type
  const cat: Filter = rawCat === "scooters" || rawCat === "cars" ? "rentals" : (rawCat as Filter);
  const rtype: RentalType = rawCat === "scooters" || rawCat === "cars" ? rawCat : ((params.get("type") as RentalType | null) ?? "all");
  const allHub = useHubListings();
  const [loc, setLoc] = useLoc();
  const hub = useMemo(() => filterHub(allHub, (town) => inLoc(loc, town)), [allHub, loc]);
  const fav = useFavourites();

  const all = useMemo(() => (hub ? [...hub.food, ...hub.stays, ...hub.cars, ...hub.scooters] : []), [hub]);
  const results = useMemo(() => {
    let list = all;
    if (cat === "food") list = hub?.food ?? [];
    else if (cat === "rentals") list = rtype === "scooters" ? hub?.scooters ?? [] : rtype === "cars" ? hub?.cars ?? [] : [...(hub?.scooters ?? []), ...(hub?.cars ?? [])];
    else if (cat === "stays") list = hub?.stays ?? [];
    else if (cat === "saved") list = all.filter((l) => fav.has(l.kind, l.id));
    else if (cat !== "all") list = [];
    if (q) {
      const words = q.toLowerCase().split(/\s+/);
      list = list.filter((l) => {
        const hay = `${l.title} ${l.subtitle} ${"category" in l ? (l as { category: string }).category : ""} ${l.kind === "scooter" ? "scooter scooters motorbike motor rental rent ride" : l.kind === "car" ? "car cars rental rent drive driver" : l.kind === "stay" ? "stay stays room rooms hotel resort accommodation house beach night" : ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    return list;
  }, [all, hub, cat, rtype, q, fav]);

  const go = (c: Filter, t: RentalType = "all") => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (c !== "all") sp.set("cat", c);
    if (c === "rentals" && t !== "all") sp.set("type", t);
    router.replace(`/explore${sp.toString() ? "?" + sp.toString() : ""}`);
  };
  const chips: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, ...hubCategories(hub).map((c) => ({ id: c.id as Filter, label: `${c.emoji} ${c.label}` })), { id: "saved", label: "♡ Saved" }];

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <h1 className="font-display text-2xl font-bold">Explore</h1>
        <HubSearch key={q} initial={q} pills={false} />
        <LocBar />
        <div role="tablist" aria-label="Filter" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {chips.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={cat === c.id}
              onClick={() => go(c.id)}
              data-testid={`filter-${c.id}`}
              className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold ${cat === c.id ? "bg-orange-700 text-white" : "border border-coffee-200 bg-white text-coffee-800"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {cat === "rentals" && (
          <div role="tablist" aria-label="Vehicle type" className="flex gap-2" data-testid="rental-types">
            {(
              [
                ["all", "All vehicles"],
                ["scooters", "🛵 Scooters"],
                ["cars", "🚗 Car rentals"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={rtype === t}
                onClick={() => go("rentals", t)}
                data-testid={`type-${t}`}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${rtype === t ? "bg-coffee-800 text-cream" : "bg-coffee-100 text-coffee-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {cat === "food" && <FoodCard />}
        {cat === "food" && (
          <Link href="/food" className="block text-right text-sm font-semibold text-orange-700 underline" data-testid="all-stores-link">
            See all food stores →
          </Link>
        )}
        {cat === "rentals" && rtype !== "cars" && <ScooterCard minRate={hub?.minRate ?? null} />}

        {!hub ? (
          <PageLoader />
        ) : (cat === "rentals" && rtype === "cars" && hub.cars.length === 0) || (SOON[cat] && !(cat === "stays" && hub.stays.length > 0)) ? (
          <section className="card p-6 text-center" data-testid="coming-soon">
            <p className="text-4xl" aria-hidden>
              {cat === "rentals" ? "🚗" : hubCategories(hub).find((c) => c.id === cat)?.emoji}
            </p>
            <p className="mt-2 font-display text-xl font-bold">Coming soon</p>
            <p className="text-coffee-700">{cat === "rentals" ? SOON.cars : SOON[cat]}</p>
            {cat === "tours" && (
              <Link href="/tours" className="btn-primary mt-4 inline-flex" data-testid="tours-notify-link">
                Notify me when tours open
              </Link>
            )}
          </section>
        ) : cat === "saved" && fav.signedIn === false ? (
          <section className="card space-y-3 p-5" data-testid="saved-signin">
            <p>Sign in to save your favourite drinks, food, rides and stays with the ♡.</p>
            <Link href="/account?next=%2Fexplore%3Fcat%3Dsaved" className="btn-primary w-full">
              Sign in
            </Link>
          </section>
        ) : results.length === 0 ? (
          <p className="card p-5 text-coffee-700" data-testid="no-results">
            {cat === "saved" ? "Nothing saved yet — tap the ♡ on anything you like." : q ? `No results for “${q}” in ${locLabel(loc)}. Try another word.` : `Nothing listed in ${locLabel(loc)} yet.`}
            {loc.island !== "all" && (
              <button type="button" className="ml-1 font-semibold text-orange-700 underline" onClick={() => setLoc({ island: "all", town: "all" })}>
                Show all of Romblon
              </button>
            )}
          </p>
        ) : (
          <>
            <p className="text-sm text-coffee-600" data-testid="result-count">
              {results.length} result{results.length === 1 ? "" : "s"}
              {q && ` for “${q}”`}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4" data-testid="results">
              {results.map((l) => (
                <ListingCard key={`${l.kind}-${l.id}`} l={l} wide />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
