"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import type { Listing } from "@/components/customer/ListingCard";
import { carSpecs } from "@/lib/rentals";

/** Home & Explore categories. "rentals" (Vehicle Rentals) holds scooters and cars. */
export type HubCategory = "food" | "rentals" | "stays" | "tours";
export type RentalType = "all" | "scooters" | "cars";
export const HUB_CATEGORIES: { id: HubCategory; label: string; emoji: string; soon: boolean }[] = [
  { id: "food", label: "Food", emoji: "🍽️", soon: false },
  { id: "rentals", label: "Vehicle Rentals", emoji: "🛵", soon: false },
  { id: "stays", label: "Stays", emoji: "🏝️", soon: true },
  { id: "tours", label: "Tours", emoji: "🧭", soon: true },
];

export interface Business {
  id: string;
  slug: string;
  name: string;
  kind: "food" | "rentals" | "stays" | "tours";
  town: string;
}

export interface HubData {
  businesses: Business[];
  /** stay properties (for counts by town) */
  properties: { id: string; name: string; town: string }[];
  food: (Listing & { category: string })[];
  scooters: Listing[];
  cars: Listing[];
  stays: Listing[];
  minStayRate: number | null;
  categories: { id: string; name: string }[];
  minFood: number | null;
  minRate: number | null;
  minCarRate: number | null;
}

/** Categories with "soon" decided by what's actually listed (Stays opens once a room is shown). */
export function hubCategories(hub: HubData | null) {
  return HUB_CATEGORIES.map((c) => (c.id === "stays" ? { ...c, soon: !hub || hub.stays.length === 0 } : c));
}
/** Lowest daily rate of any scooter or car. */
export const minVehicleRate = (hub: HubData | null) => {
  const r = [hub?.minRate, hub?.minCarRate].filter((x): x is number => x != null);
  return r.length ? Math.min(...r) : null;
};

/** Everything bookable, as listing cards: menu items (Pahuway Cafe), scooters & cars (Baybayin), rooms (Padaya Stays). */
export function useHubListings(): HubData | null {
  const [data, setData] = useState<HubData | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    Promise.all([
      sb.from("menu_categories").select("id, name").eq("is_active", true).order("sort_order"),
      sb.from("menu_items").select("id, name, price, photo_url, is_sold_out, category_id, business_id").eq("is_active", true).order("sort_order").order("name"),
      sb.from("scooters").select("id, name, daily_rate, photo_url, vehicle_type, seats, transmission, fuel, driver_fee, business_id").eq("is_active", true).order("sort_order").order("name"),
      sb.from("stay_settings").select("bookings_enabled, terms").eq("id", 1).maybeSingle(),
      sb.from("stay_rooms").select("id, name, nightly_rate, weekend_rate, photos, max_guests, stay_properties!inner(id, name, location_text, photos, is_active, town)").eq("is_active", true).eq("stay_properties.is_active", true).order("sort_order"),
      sb.from("businesses").select("id, slug, name, kind, town").order("name"),
    ]).then(([c, m, s, ss, sr, bz]) => {
      const businesses = (bz.data as Business[]) ?? [];
      const biz = new Map(businesses.map((b) => [b.id, b]));
      const townOf = (id: string | null | undefined) => (id && biz.get(id)?.town) || "San Agustin";
      const slugOf = (id: string | null | undefined) => (id && biz.get(id)?.slug) || undefined;
      const cats = (c.data as { id: string; name: string }[]) ?? [];
      const catName = new Map(cats.map((x) => [x.id, x.name]));
      const items = (m.data as { id: string; name: string; price: number; photo_url: string | null; is_sold_out: boolean; category_id: string; business_id: string | null }[]) ?? [];
      type V = { id: string; name: string; daily_rate: number; photo_url: string | null; vehicle_type: string | null; seats: number | null; transmission: "automatic" | "manual" | null; fuel: "gasoline" | "diesel" | "electric" | "hybrid" | null; driver_fee: number | null; business_id: string | null };
      const vehicles = (s.data as V[]) ?? [];
      const scooters = vehicles.filter((v) => (v.vehicle_type ?? "scooter") === "scooter");
      const cars = vehicles.filter((v) => v.vehicle_type === "car");
      const available = items.filter((i) => !i.is_sold_out);
      type R = { id: string; name: string; nightly_rate: number; weekend_rate: number | null; photos: string[]; max_guests: number; stay_properties: { id: string; name: string; location_text: string | null; photos: string[]; town: string } };
      const staysOpen = !!ss.data?.bookings_enabled && !!(ss.data?.terms as string | null)?.trim();
      const rooms = staysOpen ? ((sr.data as unknown as R[]) ?? []) : [];
      const fromRate = (r: R) => Math.min(Number(r.nightly_rate), Number(r.weekend_rate ?? r.nightly_rate));
      const props = new Map(rooms.map((r) => [r.stay_properties.id, { id: r.stay_properties.id, name: r.stay_properties.name, town: r.stay_properties.town }]));
      setData({
        businesses,
        properties: [...props.values()],
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
          town: townOf(i.business_id),
          business: slugOf(i.business_id),
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
          town: townOf(x.business_id),
          business: slugOf(x.business_id),
        })),
        minFood: available.length ? Math.min(...available.map((i) => Number(i.price))) : null,
        minRate: scooters.length ? Math.min(...scooters.map((x) => Number(x.daily_rate))) : null,
        cars: cars.map((x) => ({
          kind: "car" as const,
          id: x.id,
          href: `/baybayin?type=car&scooter=${x.id}`,
          title: x.name,
          subtitle: [carSpecs(x) || "Car", x.driver_fee != null ? "with or without driver" : "self-drive"].join(" · "),
          price: `From ${formatPeso(x.daily_rate)} / day`,
          photo: x.photo_url,
          emoji: "🚗",
          town: townOf(x.business_id),
          business: slugOf(x.business_id),
        })),
        minCarRate: cars.length ? Math.min(...cars.map((x) => Number(x.daily_rate))) : null,
        stays: rooms.map((r) => ({
          kind: "stay" as const,
          id: r.id,
          href: `/stays/${r.id}`,
          title: r.name,
          subtitle: [r.stay_properties.name, r.stay_properties.location_text, `up to ${r.max_guests} guests`].filter(Boolean).join(" · "),
          price: `From ${formatPeso(fromRate(r))} / night`,
          photo: r.photos[0] ?? r.stay_properties.photos[0] ?? null,
          emoji: "🏝️",
          town: r.stay_properties.town,
          business: "padaya-stays",
        })),
        minStayRate: rooms.length ? Math.min(...rooms.map(fromRate)) : null,
      });
    });
  }, []);
  return data;
}

/** Only the listings in the chosen island / town, with From-prices and counts recalculated. */
export function filterHub(hub: HubData | null, keep: (town: string | undefined) => boolean): HubData | null {
  if (!hub) return null;
  const num = (p: string) => Number(p.replace(/[^0-9.]/g, "")) || 0;
  const min = (l: Listing[]) => (l.length ? Math.min(...l.map((x) => num(x.price))) : null);
  const food = hub.food.filter((l) => keep(l.town));
  const scooters = hub.scooters.filter((l) => keep(l.town));
  const cars = hub.cars.filter((l) => keep(l.town));
  const stays = hub.stays.filter((l) => keep(l.town));
  const avail = food.filter((l) => !l.badge);
  return {
    ...hub,
    food,
    scooters,
    cars,
    stays,
    businesses: hub.businesses.filter((b) => keep(b.town)),
    properties: hub.properties.filter((p) => keep(p.town)),
    minFood: avail.length ? Math.min(...avail.map((l) => num(l.price))) : null,
    minRate: min(scooters),
    minCarRate: min(cars),
    minStayRate: min(stays),
  };
}
