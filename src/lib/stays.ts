"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export interface StaySettings {
  bookings_enabled: boolean;
  deposit_percent: number;
  free_cancel_days: number;
  max_nights: number;
  terms: string | null;
}
export interface StayProperty {
  id: string;
  name: string;
  description: string | null;
  location_text: string | null;
  town: string;
  map_url: string | null;
  photos: string[];
  amenities: string[];
  house_rules: string | null;
  check_in_time: string;
  check_out_time: string;
  is_active: boolean;
  sort_order: number;
}
export interface StayRoom {
  id: string;
  property_id: string;
  name: string;
  description: string | null;
  photos: string[];
  amenities: string[];
  nightly_rate: number;
  weekend_rate: number | null;
  max_guests: number;
  units: number;
  min_nights: number;
  is_active: boolean;
  sort_order: number;
  stay_properties?: StayProperty;
}
export type StayStatus = "awaiting_deposit" | "confirmed" | "checked_in" | "checked_out" | "cancelled";
export const STAY_STATUS_LABEL: Record<StayStatus, string> = {
  awaiting_deposit: "Checking deposit",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
};

export const staysOpen = (s: StaySettings | null) => !!s?.bookings_enabled && !!s.terms?.trim();

export function useStaySettings() {
  const [s, setS] = useState<StaySettings | null>(null);
  useEffect(() => {
    getSupabase().from("stay_settings").select("*").eq("id", 1).single().then(({ data }) => data && setS(data as StaySettings));
  }, []);
  return s;
}

/** Add days to "YYYY-MM-DD". */
export const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Fri & Sat nights use the weekend rate. */
export const isWeekendNight = (ymd: string) => [5, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());
export function stayQuote(room: Pick<StayRoom, "nightly_rate" | "weekend_rate">, checkIn: string, checkOut: string) {
  const n = nightsBetween(checkIn, checkOut);
  let weekday = 0,
    weekend = 0;
  for (let i = 0; i < n; i++) (isWeekendNight(addDaysYmd(checkIn, i)) ? weekend++ : weekday++);
  const wkRate = Number(room.weekend_rate ?? room.nightly_rate);
  return { nights: n, weekday, weekend, weekdayRate: Number(room.nightly_rate), weekendRate: wkRate, total: weekday * Number(room.nightly_rate) + weekend * wkRate };
}
export const prettyYmd = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
export const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
