"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";

/** Pages without the footer: staff / rider screens, sign-in flows, and checkout (it has its own bottom bar). */
const HIDDEN = /^\/(admin|rider|login|checkout|welcome|auth)(\/|$)/;

/** Unread inbox count for the signed-in customer, kept live. */
export function useUnreadMessages() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || !alive) return;
      const refresh = async () => {
        const { count: n } = await supabase.from("customer_messages").select("id", { count: "exact", head: true }).is("read_at", null);
        if (alive) setCount(n ?? 0);
      };
      await refresh();
      const authed = await getAuthedSupabase();
      const ch = authed
        .channel(`inbox-${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "customer_messages", filter: `user_id=eq.${uid}` }, refresh)
        .subscribe();
      const onRead = () => refresh();
      window.addEventListener("inbox-read", onRead);
      cleanup = () => {
        authed.removeChannel(ch);
        window.removeEventListener("inbox-read", onRead);
      };
    })();
    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);
  return count;
}

/** App-style footer for customers: Home · Stays · Rentals · Food · Trips (messages are in the header). */
export function BottomNav() {
  const path = usePathname() ?? "/";
  const hidden = HIDDEN.test(path);
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), [path]);
  useEffect(() => {
    // Explore switches category with router.replace (same path) — keep the active tab in sync
    const t = setInterval(() => setSearch((s) => (s === window.location.search ? s : window.location.search)), 400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("has-bottom-nav", !hidden);
    return () => document.body.classList.remove("has-bottom-nav");
  }, [hidden]);

  if (hidden) return null;
  const isFood = path.startsWith("/menu") || (path.startsWith("/explore") && search.includes("cat=food"));
  const isRentals = (path.startsWith("/baybayin") && !path.startsWith("/baybayin/booking")) || (path.startsWith("/explore") && search.includes("cat=rentals"));
  const tabs = [
    { href: "/", label: "Home", active: path === "/" || path.startsWith("/tours") || (path.startsWith("/explore") && !isFood && !isRentals), icon: HomeIcon },
    { href: "/stays", label: "Stays", active: path.startsWith("/stays") && !path.startsWith("/stays/booking"), icon: StaysIcon },
    { href: "/explore?cat=rentals", label: "Rentals", active: isRentals, icon: RentalsIcon },
    { href: "/explore?cat=food", label: "Food", active: isFood, icon: FoodIcon },
    { href: "/activity", label: "Trips", active: path.startsWith("/activity") || path.startsWith("/order/") || path.startsWith("/baybayin/booking") || path.startsWith("/stays/booking"), icon: TripsIcon },
  ];
  return (
    <nav aria-label="Main" data-testid="bottom-nav" className="fixed inset-x-0 bottom-0 z-40 border-t border-coffee-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              data-testid={`nav-${t.label.toLowerCase()}`}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${t.active ? "text-orange-700" : "text-coffee-500"}`}
            >
              <t.icon filled={t.active} />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const svg = "h-6 w-6";
function HomeIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function StaysIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M3 21V11l9-6 9 6v10" />
      <path d="M9 21v-6h6v6" fill="none" stroke={filled ? "#fff" : "currentColor"} />
    </svg>
  );
}
function RentalsIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth={filled ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17" r="3" />
      <circle cx="18.5" cy="17" r="3" />
      <path d="M8.5 17h6l2-7h-4M14 6h3l1.5 4M5.5 17l3-6h5" />
    </svg>
  );
}
function FoodIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z" />
      <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16" fill="none" />
      <path d="M8 3v3M11 3v3M14 3v3" fill="none" />
    </svg>
  );
}
function TripsIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth={filled ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18" />
    </svg>
  );
}
export function MessageIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}
