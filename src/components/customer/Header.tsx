"use client";
import Link from "next/link";
import { MessageIcon, useUnreadMessages } from "./BottomNav";
import { formatClock } from "@/lib/hours";
import type { StoreSettings } from "@/lib/types";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, type BrandKey } from "@/lib/brands";
import { headerTheme, headerVars, isHex } from "@/lib/color";

export function Logo({ small = false, brand = "cafe" }: { small?: boolean; brand?: BrandKey }) {
  const { settings } = useStoreSettings();
  const b = brandOf(settings, brand);
  return (
    <Link href={brand === "baybayin" ? "/baybayin" : "/"} className="flex min-w-0 items-center gap-2.5" aria-label={`${b.name} home`}>
      {b.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.logo} alt="" className={`${small ? "h-9 w-9" : "h-11 w-11"} shrink-0 rounded-full object-cover`} data-testid="brand-logo" />
      ) : (
        <span aria-hidden className={`${small ? "h-9 w-9 text-lg" : "h-11 w-11 text-2xl"} flex shrink-0 items-center justify-center rounded-full bg-sky-100`}>
          {b.emoji}
        </span>
      )}
      <span className="min-w-0 leading-tight">
        {/* Long names wrap onto up to two lines on phones instead of being cut off */}
        <span
          data-testid="store-title"
          className={`line-clamp-2 break-words font-display font-bold leading-tight text-[color:var(--hfg,#2e1e14)] ${
            small ? "text-base sm:text-lg" : "text-base min-[400px]:text-lg sm:text-xl"
          }`}
        >
          {b.name}
        </span>
        {!small && b.tagline && (
          <span data-testid="brand-tagline" className="hidden whitespace-nowrap text-xs font-medium text-[color:var(--hmuted,#714a2f)] sm:block">
            {b.tagline}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Props for a customer-facing header: admin colour (with readable text) or the default cream. */
export function useCustomerHeaderStyle(brand: BrandKey = "cafe"): { className: string; style?: React.CSSProperties } {
  const { settings } = useStoreSettings();
  const color = brandOf(settings, brand).color;
  if (!isHex(color)) return { className: "border-coffee-100 bg-cream/95 backdrop-blur" };
  const t = headerTheme(color);
  return { className: "border-black/10 bg-[color:var(--hbg)]", style: headerVars(t, "h") };
}

export function StoreHeader({ settings, open, back, brand = "cafe" }: { settings: StoreSettings | null; open: boolean; back?: string; brand?: BrandKey }) {
  const hs = useCustomerHeaderStyle(brand);
  return (
    <header data-testid="customer-header" className={`sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] ${hs.className}`} style={hs.style}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {back && (
            <Link href={back} className="btn-ghost btn-sm -ml-2 h-10 w-10 !px-0 text-xl !text-[color:var(--hfg,#5a3a25)] hover:!bg-[color:var(--hhover,#efe4d8)]" aria-label="Back">
              ←
            </Link>
          )}
          <Logo small={!!back} brand={brand} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {settings && brand === "cafe" && (
            <span
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${open ? "bg-sage-100 text-sage-700" : "bg-stone-200 text-stone-800"}`}
            >
              {open ? (
                <>
                  Open<span className="hidden sm:inline"> · until {formatClock(settings.close_time)}</span>
                </>
              ) : (
                "Closed"
              )}
            </span>
          )}
          <MessagesLink />
          <Link href="/account" className="btn-ghost btn-sm h-10 w-10 !px-0 !text-[color:var(--hfg,#5a3a25)] hover:!bg-[color:var(--hhover,#efe4d8)]" aria-label="My account">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Messages (order, booking and stay updates) with a live unread badge — in the header, next to My account. */
function MessagesLink() {
  const unread = useUnreadMessages();
  return (
    <Link
      href="/messages"
      data-testid="nav-messages"
      className="btn-ghost btn-sm relative h-10 w-10 !px-0 !text-[color:var(--hfg,#5a3a25)] hover:!bg-[color:var(--hhover,#efe4d8)]"
      aria-label={unread ? `Messages, ${unread} unread` : "Messages"}
    >
      <MessageIcon filled={false} />
      {unread > 0 && (
        <span data-testid="unread-badge" className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
          {unread > 9 ? "9+" : unread}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}
