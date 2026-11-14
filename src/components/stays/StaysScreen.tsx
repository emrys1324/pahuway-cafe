"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { staysOpen, useStaySettings, type StayProperty, type StayRoom } from "@/lib/stays";

/** All stays: each property with its room types. */
export function StaysScreen() {
  const { settings, open } = useStoreSettings();
  const ss = useStaySettings();
  const [props, setProps] = useState<(StayProperty & { stay_rooms: StayRoom[] })[] | null>(null);
  useEffect(() => {
    getSupabase()
      .from("stay_properties")
      .select("*, stay_rooms(*)")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setProps(((data as (StayProperty & { stay_rooms: StayRoom[] })[]) ?? []).map((p) => ({ ...p, stay_rooms: p.stay_rooms.filter((r) => r.is_active).sort((a, b) => a.sort_order - b.sort_order) })).filter((p) => p.stay_rooms.length)));
  }, []);

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" back="/" />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Stays</h1>
          <p className="text-coffee-700">Rooms and houses on Tablas Island — book with a deposit, pay the rest at check-in.</p>
        </div>
        {!props || !ss ? (
          <PageLoader />
        ) : !staysOpen(ss) || props.length === 0 ? (
          <section className="card p-6 text-center" data-testid="stays-soon">
            <p className="text-4xl" aria-hidden>
              🏝️
            </p>
            <p className="mt-2 font-display text-xl font-bold">Coming soon</p>
            <p className="text-coffee-700">Stays open here soon — beach houses and rooms on Tablas, booked right in Padaya.</p>
          </section>
        ) : (
          props.map((p) => (
            <section key={p.id} className="space-y-3" data-testid="stay-property">
              <div>
                <h2 className="font-display text-xl font-bold">{p.name}</h2>
                {p.location_text && <p className="text-sm text-coffee-600">📍 {p.location_text}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {p.stay_rooms.map((r) => {
                  const photo = r.photos[0] ?? p.photos[0] ?? null;
                  return (
                    <Link key={r.id} href={`/stays/${r.id}`} className="card group block overflow-hidden" data-testid="stay-room-card">
                      <div className="aspect-[4/3] overflow-hidden bg-coffee-100">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                        ) : (
                          <span aria-hidden className="flex h-full items-center justify-center text-5xl">
                            🛏️
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 p-4">
                        <p className="font-bold">{r.name}</p>
                        <p className="text-sm text-coffee-600">
                          Up to {r.max_guests} guest{r.max_guests > 1 ? "s" : ""}
                          {r.min_nights > 1 ? ` · min ${r.min_nights} nights` : ""}
                        </p>
                        <p className="font-semibold">From {formatPeso(Math.min(Number(r.nightly_rate), Number(r.weekend_rate ?? r.nightly_rate)))} / night</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
