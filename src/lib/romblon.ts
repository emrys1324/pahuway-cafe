"use client";
import { useCallback, useEffect, useState } from "react";

/** Romblon's island groups and 17 towns — for the island / town filter (same list as romblon_towns() in the DB). */
export type IslandId = "tablas" | "romblon" | "sibuyan" | "carabao" | "north";
export const ISLANDS: { id: IslandId; name: string; sub: string; colors: [string, string] }[] = [
  { id: "tablas", name: "Tablas", sub: "Largest island · Odiongan, Looc, San Agustin", colors: ["#fdba74", "#c2410c"] },
  { id: "romblon", name: "Romblon Island", sub: "Capital town · marble & beaches", colors: ["#fed7aa", "#9a3412"] },
  { id: "sibuyan", name: "Sibuyan", sub: "Mountains, rivers & waterfalls", colors: ["#d6c4b0", "#5a3a25"] },
  { id: "carabao", name: "Carabao Island", sub: "White-sand beaches · San Jose", colors: ["#fde68a", "#ea580c"] },
  { id: "north", name: "Banton, Simara & Maestro de Campo", sub: "Northern islands", colors: ["#e7d3c0", "#7c2d12"] },
];
export const TOWNS: { name: string; island: IslandId }[] = (
  [
    ["Alcantara", "tablas"], ["Calatrava", "tablas"], ["Ferrol", "tablas"], ["Looc", "tablas"], ["Odiongan", "tablas"], ["San Agustin", "tablas"],
    ["San Andres", "tablas"], ["Santa Fe", "tablas"], ["Santa Maria", "tablas"], ["Romblon", "romblon"], ["Cajidiocan", "sibuyan"],
    ["Magdiwang", "sibuyan"], ["San Fernando", "sibuyan"], ["San Jose", "carabao"], ["Banton", "north"], ["Corcuera", "north"], ["Concepcion", "north"],
  ] as const
).map(([name, island]) => ({ name, island }));
export const DEFAULT_TOWN = "San Agustin";
export const islandOf = (town: string | null | undefined) => TOWNS.find((t) => t.name === (town || DEFAULT_TOWN))?.island ?? "tablas";
export const islandName = (id: IslandId) => ISLANDS.find((i) => i.id === id)?.name ?? "";

export interface Loc {
  island: IslandId | "all";
  town: string | "all";
}
const KEY = "padaya-loc";
const EVENT = "padaya-loc";
export const ALL: Loc = { island: "all", town: "all" };
export const inLoc = (loc: Loc, town: string | null | undefined) => {
  const t = town || DEFAULT_TOWN;
  return (loc.town === "all" || loc.town === t) && (loc.island === "all" || islandOf(t) === loc.island);
};
export const locLabel = (loc: Loc) => (loc.town !== "all" ? loc.town : loc.island !== "all" ? islandName(loc.island) : "all of Romblon");

/** The island / town the customer is browsing, remembered on this phone and shared by every page. */
export function useLoc(): [Loc, (l: Loc) => void] {
  const [loc, setLocState] = useState<Loc>(ALL);
  useEffect(() => {
    const read = () => {
      try {
        const v = JSON.parse(localStorage.getItem(KEY) || "null");
        if (v && typeof v.island === "string" && typeof v.town === "string") setLocState(v);
        else setLocState(ALL);
      } catch {
        setLocState(ALL);
      }
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const setLoc = useCallback((l: Loc) => {
    setLocState(l);
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [loc, setLoc];
}
