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

/** App-style footer for customers: Home · Activity · Messages. */
export function BottomNav() {
  const path = usePathname() ?? "/";
  const hidden = HIDDEN.test(path);
  const unread = useUnreadMessages();

  useEffect(() => {
    document.body.classList.toggle("has-bottom-nav", !hidden);
    return () => document.body.classList.remove("has-bottom-nav");
  }, [hidden]);

  if (hidden) return null;
  const tabs = [
    { href: "/", label: "Home", active: path === "/" || path.startsWith("/menu") || path.startsWith("/baybayin") && !path.startsWith("/baybayin/booking"), icon: HomeIcon },
    { href: "/explore", label: "Explore", active: path.startsWith("/explore"), icon: ExploreIcon },
    { href: "/activity", label: "Activity", active: path.startsWith("/activity") || path.startsWith("/order/") || path.startsWith("/baybayin/booking"), icon: ActivityIcon },
    { href: "/messages", label: "Messages", active: path.startsWith("/messages"), icon: MessageIcon, badge: unread },
  ];
  return (
    <nav aria-label="Main" data-testid="bottom-nav" className="fixed inset-x-0 bottom-0 z-40 border-t border-coffee-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-4">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              data-testid={`nav-${t.label.toLowerCase()}`}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${t.active ? "text-orange-700" : "text-coffee-500"}`}
            >
              <span className="relative">
                <t.icon filled={t.active} />
                {!!t.badge && (
                  <span data-testid="unread-badge" className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
                    {t.badge > 9 ? "9+" : t.badge}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </span>
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
function ExploreIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth={filled ? 2.4 : 1.8} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function ActivityIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth={filled ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function MessageIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={svg} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}
