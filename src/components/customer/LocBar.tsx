"use client";
import { ISLANDS, TOWNS, useLoc, type IslandId } from "@/lib/romblon";

/** "📍 All Romblon · Tablas · Romblon Island · …" — then the towns of the chosen island. Filters Home, Explore and Stays. */
export function LocBar() {
  const [loc, setLoc] = useLoc();
  const chip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${on ? "bg-orange-700 text-white shadow-sm" : "border border-coffee-200 bg-white text-coffee-800 hover:border-orange-400"}`;
  const towns = loc.island === "all" ? [] : TOWNS.filter((t) => t.island === loc.island);
  return (
    <div className="space-y-2" data-testid="locbar">
      <div role="radiogroup" aria-label="Island" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        <span aria-hidden className="shrink-0 text-lg">
          📍
        </span>
        <button type="button" role="radio" aria-checked={loc.island === "all"} className={chip(loc.island === "all")} onClick={() => setLoc({ island: "all", town: "all" })} data-testid="loc-all">
          All Romblon
        </button>
        {ISLANDS.map((i) => (
          <button key={i.id} type="button" role="radio" aria-checked={loc.island === i.id} className={chip(loc.island === i.id)} onClick={() => setLoc({ island: i.id as IslandId, town: "all" })} data-testid={`loc-${i.id}`}>
            {i.id === "north" ? "Northern islands" : i.name}
          </button>
        ))}
      </div>
      {towns.length > 1 && (
        <div role="radiogroup" aria-label="Town" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" data-testid="town-bar">
          <button type="button" role="radio" aria-checked={loc.town === "all"} className={`${chip(loc.town === "all")} !py-1 text-xs`} onClick={() => setLoc({ ...loc, town: "all" })}>
            All towns
          </button>
          {towns.map((t) => (
            <button key={t.name} type="button" role="radio" aria-checked={loc.town === t.name} className={`${chip(loc.town === t.name)} !py-1 text-xs`} onClick={() => setLoc({ ...loc, town: t.name })}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
