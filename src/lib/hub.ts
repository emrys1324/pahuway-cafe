"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import type { Listing } from "@/components/customer/ListingCard";

export type HubCategory = "food" | "scooters" | "cars" | "stays" | "tours";
export const HUB_CATEGORIES: { id: HubCategory; label: string; emoji: string; soon: boolean }[] = [
  { id: "food", label: "Food", emoji: "🍽️", soon: false },
  { id: "scooters", label: "Scooters", emoji: "🛵", soon: false },
  { id: "cars", label: "Cars", emoji: "🚗", soon: true },
  { id: "stays", label: "Stays", emoji: "🏝️", soon: true },
  { id: "tours", label: "Tours", emoji: "🧭", soon: true },
];

export interface HubData {
  food: (Listing & { category: string })[];
  scooters: Listing[];
  categories: { id: string; name: string }[];
  minFood: number | null;
  minRate: number | null;
}

/** Everything bookable, as listing cards: menu items (Pahuway Cafe) and scooters (Baybayin). */
export function useHubListings(): HubData | null {
  const [data, setData] = useState<HubData | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    Promise.all([
      sb.from("menu_categories").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("menu_items").select("id, name, price, photo_url, is_sold_out, category_id").eq("is_active", true).order("sort_order").order("name"),
      sb.from("scooters").select("id, name, daily_rate, photo_url").eq("is_active", true).order("sort_order").order("name"),
    ]).then(([c, m, s]) => {
      const cats = (c.data as { id: string; name: string }[]) ?? [];
      const catName = new Map(cats.map((x) => [x.id, x.name]));
      const items = (m.data as { id: string; name: string; price: number; photo_url: string | null; is_sold_out: boolean; category_id: string }[]) ?? [];
      const scooters = (s.data as { id: string; name: string; daily_rate: number; photo_url: string | null }[]) ?? [];
      const available = items.filter((i) => !i.is_sold_out);
      setData({
        categories: cats,
        food: items.map((i) => ({
          kind: "menu_item" as const,
          id: i.id,
          href: `/menu?item=${i.id}`,
          title: i.name,
          subtitle: `${catName.get(i.category_id) ?? "Menu"} · Pahuway Cafe`,
          price: formatPeso(i.price),
          photo: i.photo_url,
          badge: i.is_sold_out ? "Sold out" : null,
          emoji: "☕",
          category: catName.get(i.category_id) ?? "",
        })),
        scooters: scooters.map((x) => ({
          kind: "scooter" as const,
          id: x.id,
          href: `/baybayin?scooter=${x.id}`,
          title: x.name,
          subtitle: "Scooter · Baybayin",
          price: `From ${formatPeso(x.daily_rate)} / day`,
          photo: x.photo_url,
          emoji: "🛵",
        })),
        minFood: available.length ? Math.min(...available.map((i) => Number(i.price))) : null,
        minRate: scooters.length ? Math.min(...scooters.map((x) => Number(x.daily_rate))) : null,
      });
    });
  }, []);
  return data;
}
