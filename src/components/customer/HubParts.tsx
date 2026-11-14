"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListingCard, type Listing } from "./ListingCard";
import { HUB_CATEGORIES } from "@/lib/hub";

/** koobo-style search: one box for food, scooters, cars and stays, plus category shortcuts. */
export function HubSearch({ initial = "", pills = true }: { initial?: string; pills?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <section className="space-y-3" data-testid="hub-search">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        }}
        className="flex items-center gap-2 rounded-full border border-orange-200 bg-white p-1.5 pl-4 shadow-sm focus-within:ring-2 focus-within:ring-orange-300"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 stroke-coffee-500" fill="none" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-coffee-500"
          placeholder="Search food, scooters, cars or stays…"
          aria-label="Search Padaya"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="rounded-full bg-orange-700 px-4 py-2 font-semibold text-white hover:bg-orange-800" aria-label="Search">
          Search
        </button>
      </form>
      {pills && (
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Categories">
        {HUB_CATEGORIES.map((c) => (
          <li key={c.id} className="shrink-0">
            <Link
              href={`/explore?cat=${c.id}`}
              data-testid={`pill-${c.id}`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-coffee-200 bg-white px-3.5 text-sm font-semibold text-coffee-800 hover:border-orange-400 hover:bg-orange-50"
            >
              <span aria-hidden>{c.emoji}</span>
              {c.label}
              {c.soon && <span className="rounded-full bg-coffee-100 px-1.5 text-[10px] font-bold uppercase text-coffee-600">Soon</span>}
            </Link>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}

/** A titled, swipeable row of listing cards with "See all". */
export function ListingRow({ title, subtitle, href, listings, testId }: { title: string; subtitle?: string; href: string; listings: Listing[]; testId: string }) {
  if (listings.length === 0) return null;
  return (
    <section aria-label={title} data-testid={testId}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="text-sm text-coffee-600">{subtitle}</p>}
        </div>
        <Link href={href} className="shrink-0 text-sm font-semibold text-orange-700 underline underline-offset-2">
          See all →
        </Link>
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {listings.map((l) => (
          <ListingCard key={`${l.kind}-${l.id}`} l={l} />
        ))}
      </div>
    </section>
  );
}
