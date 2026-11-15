"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { storeNow, withinHours, isStoreOpen, formatClock } from "@/lib/hours";
import type { StoreSettings } from "@/lib/types";

/** A food store on Padaya (a business of kind "food"). Pahuway Cafe's hours come from Settings. */
export interface Store {
  id: string;
  slug: string;
  name: string;
  kind: "food";
  town: string;
  tagline: string | null;
  emoji: string;
  logo_url: string | null;
  is_active: boolean;
  is_open: boolean;
  open_time: string;
  close_time: string;
  prep_minutes: number;
  sort_order: number;
}
export const MAIN_STORE = "pahuway-cafe";
export const storeHref = (slug: string) => (slug === MAIN_STORE ? "/menu" : `/food/${slug}`);

/** Is the store taking orders now? (same rule as business_is_open_now() in the database) */
export function storeOpenNow(s: Store | null | undefined, settings: StoreSettings | null): boolean {
  if (!s || !s.is_active) return false;
  if (s.slug === MAIN_STORE) return isStoreOpen(settings);
  return s.is_open && withinHours(storeNow(settings?.timezone ?? "Asia/Manila").minutes, s.open_time, s.close_time);
}
export function storeHours(s: Store, settings: StoreSettings | null) {
  const o = s.slug === MAIN_STORE ? settings?.open_time : s.open_time;
  const c = s.slug === MAIN_STORE ? settings?.close_time : s.close_time;
  return o && c ? `${formatClock(o)} – ${formatClock(c)}` : "";
}
export const storePrep = (s: Store, settings: StoreSettings | null) => (s.slug === MAIN_STORE ? settings?.prep_minutes ?? s.prep_minutes : s.prep_minutes);

/** Active food stores (or every store, for staff), live-ish: reloads when the tab comes back. */
export function useStores(all = false) {
  const [stores, setStores] = useState<Store[] | null>(null);
  useEffect(() => {
    const load = () => {
      let q = getSupabase().from("businesses").select("*").eq("kind", "food");
      if (!all) q = q.eq("is_active", true);
      q.order("sort_order").order("name").then(({ data }) => setStores((data as Store[]) ?? []));
    };
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [all]);
  return stores;
}
