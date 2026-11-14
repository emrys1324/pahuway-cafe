"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFavourites, type FavKind } from "@/lib/favourites";

export interface Listing {
  kind: FavKind;
  id: string;
  href: string;
  title: string;
  subtitle: string; // e.g. "Pahuway Cafe" or "Scooter · Baybayin"
  price: string; // e.g. "₱120" or "From ₱600 / day"
  photo: string | null;
  badge?: string | null; // e.g. "Sold out", "New"
  emoji?: string;
}

/** Listing card (photo, ♡ save, title, subtitle, price) — used in the home rows and on Explore. */
export function ListingCard({ l, wide = false }: { l: Listing; wide?: boolean }) {
  const fav = useFavourites();
  const router = useRouter();
  const saved = fav.has(l.kind, l.id);
  const onHeart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = await fav.toggle(l.kind, l.id);
    if (r === "signin") router.push(`/account?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  };
  return (
    <Link href={l.href} className={`group block ${wide ? "" : "w-56 shrink-0 sm:w-64"}`} data-testid="listing-card" data-kind={l.kind}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-coffee-100">
        {l.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.photo} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <span aria-hidden className="flex h-full w-full items-center justify-center text-5xl">
            {l.emoji ?? "✨"}
          </span>
        )}
        {l.badge && <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-coffee-900 shadow">{l.badge}</span>}
        <button
          type="button"
          onClick={onHeart}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${l.title} from saved` : `Save ${l.title}`}
          data-testid="fav-button"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow transition hover:scale-110"
        >
          <svg aria-hidden viewBox="0 0 24 24" className={`h-5 w-5 ${saved ? "fill-orange-600 stroke-orange-600" : "fill-none stroke-coffee-800"}`} strokeWidth={2}>
            <path d="M12 21s-7-4.4-9.3-9C1.2 8.6 3.2 5 6.6 5c2 0 3.4 1.1 4.1 2.3h2.6C14 6.1 15.4 5 17.4 5c3.4 0 5.4 3.6 3.9 7C19 16.6 12 21 12 21z" />
          </svg>
        </button>
      </div>
      <p className="mt-2 line-clamp-1 font-bold text-coffee-900">{l.title}</p>
      <p className="line-clamp-1 text-sm text-coffee-600">{l.subtitle}</p>
      <p className="text-sm font-semibold text-coffee-900">{l.price}</p>
    </Link>
  );
}
