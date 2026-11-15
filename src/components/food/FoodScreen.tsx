"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { LocBar } from "@/components/customer/LocBar";
import { PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf } from "@/lib/brands";
import { inLoc, locLabel, useLoc } from "@/lib/romblon";
import { MAIN_STORE, storeHours, storeHref, storeOpenNow, storePrep, useStores, type Store } from "@/lib/stores";

/** Food delivery: every food store on Padaya (in the chosen island / town), open ones first. */
export function FoodScreen() {
  const { settings, open } = useStoreSettings();
  const stores = useStores();
  const [loc, setLoc] = useLoc();
  const [minFee, setMinFee] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const db = getSupabase();
    db.from("delivery_zones").select("fee").eq("is_active", true).order("fee").limit(1).then(({ data }) => setMinFee(data?.[0] ? Number(data[0].fee) : null));
    db.from("menu_items").select("business_id").eq("is_active", true).then(({ data }) => {
      const c: Record<string, number> = {};
      (data ?? []).forEach((r: { business_id: string | null }) => r.business_id && (c[r.business_id] = (c[r.business_id] ?? 0) + 1));
      setCounts(c);
    });
  }, []);
  const shown = (stores ?? []).filter((s) => inLoc(loc, s.town) && (counts[s.id] ?? 0) > 0);
  const sorted = [...shown].sort((a, b) => Number(storeOpenNow(b, settings)) - Number(storeOpenNow(a, settings)) || a.sort_order - b.sort_order);
  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Food delivery</h1>
          <p className="text-coffee-700">
            Each store delivers within its own town{minFee != null ? ` · delivery from ${formatPeso(minFee)}` : ""}. Pay cash or GCash. One store per order.
          </p>
        </div>
        <LocBar />
        {!stores ? (
          <PageLoader />
        ) : sorted.length === 0 ? (
          <section className="card p-6 text-center" data-testid="food-none-here">
            <p className="font-semibold">No food stores in {locLabel(loc)} yet.</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => setLoc({ island: "all", town: "all" })}>
              Show all of Romblon
            </button>
          </section>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="store-list">
            {sorted.map((s) => (
              <li key={s.id}>
                <StoreCard s={s} n={counts[s.id] ?? 0} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function StoreCard({ s, n }: { s: Store; n: number }) {
  const { settings } = useStoreSettings();
  const open = storeOpenNow(s, settings);
  const logo = s.logo_url || (s.slug === MAIN_STORE ? brandOf(settings, "cafe").logo : null);
  const name = s.slug === MAIN_STORE ? brandOf(settings, "cafe").name : s.name;
  return (
    <Link href={storeHref(s.slug)} data-testid={`store-${s.slug}`} className={`card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md ${open ? "" : "opacity-80"}`}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
      ) : (
        <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-4xl">
          {s.emoji}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-bold leading-tight">{name}</span>
        <span className="block text-sm text-coffee-700">{s.tagline || (s.slug === MAIN_STORE ? "Coffee, drinks & food" : `${n} items`)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-coffee-600">
          <span className={`rounded-full px-2 py-0.5 font-bold ${open ? "bg-orange-100 text-orange-800" : "bg-stone-200 text-stone-700"}`}>{open ? "Open" : "Closed"}</span>
          📍 {s.town} · {storeHours(s, settings)} · ~{storePrep(s, settings)} min
        </span>
      </span>
    </Link>
  );
}
