"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StoreHeader } from "./Header";
import { ItemSheet } from "./ItemSheet";
import { CartDrawer } from "./CartDrawer";
import { useMenu } from "./useMenu";
import { Alert, Badge, ItemPhoto, PageLoader } from "@/components/ui";
import { useCart, getRecentOrders, type RecentOrder } from "@/lib/cart";
import { formatPeso } from "@/lib/format";
import { formatClock, formatHours } from "@/lib/hours";
import { useStoreSettings } from "@/lib/store-settings";
import { useFirstName } from "@/lib/use-first-name";
import type { MenuItem } from "@/lib/types";

export function MenuScreen() {
  const { data, error } = useMenu();
  const { settings, open } = useStoreSettings();
  const { count, subtotal, lines } = useCart();
  const firstName = useFirstName();
  const [active, setActive] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [recent, setRecent] = useState<RecentOrder | null>(null);

  useEffect(() => {
    const r = getRecentOrders()[0];
    if (r && Date.now() - new Date(r.created_at).getTime() < 12 * 3600_000) setRecent(r);
  }, []);

  // keep the open sheet in sync with live sold-out changes
  const activeLive = active && data ? data.items.find((i) => i.id === active.id) ?? null : active;
  const soldOutIds = useMemo(() => new Set((data?.items ?? []).filter((i) => i.is_sold_out).map((i) => i.id)), [data]);
  // items removed from the menu count as unavailable too
  const unavailable = useMemo(() => {
    if (!data) return soldOutIds;
    const ids = new Set(data.items.map((i) => i.id));
    const s = new Set(soldOutIds);
    lines.forEach((l) => !ids.has(l.menu_item_id) && s.add(l.menu_item_id));
    return s;
  }, [data, soldOutIds, lines]);

  const sections = useMemo(
    () => (data ? data.categories.map((c) => ({ ...c, items: data.items.filter((i) => i.category_id === c.id) })).filter((c) => c.items.length) : []),
    [data],
  );

  return (
    <div className="min-h-screen pb-28">
      <StoreHeader settings={settings} open={open} />

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-5">
          <h1 data-testid="menu-greeting" className="font-display text-2xl font-bold leading-tight sm:text-4xl">
            Welcome
            {firstName !== undefined && (
              <>
                , <span className="text-sage-600">{firstName ?? "guest"}</span>
              </>
            )}
            !
          </h1>
          <p className="mt-1 text-coffee-700">Specialty coffee &amp; island comfort food. Pickup, dine-in pre-order or delivery.</p>
          {settings && <p className="mt-1 text-sm font-medium text-coffee-600">Open daily · {formatHours(settings)}</p>}
        </section>

        {settings && !open && (
          <div className="mb-4">
            <Alert tone="amber">
              <p className="font-bold">We&apos;re closed right now.</p>
              <p className="font-normal">
                {settings.closed_message}
                {settings.is_open && ` Ordering opens at ${formatClock(settings.open_time)}.`}
              </p>
            </Alert>
          </div>
        )}

        {recent && (
          <Link href={`/order/${recent.token}`} className="mb-4 flex items-center justify-between rounded-2xl bg-sage-600 px-4 py-3 font-semibold text-white">
            <span>Track your order {recent.order_number}</span>
            <span aria-hidden>→</span>
          </Link>
        )}

        {error && <Alert>Couldn&apos;t load the menu. Please check your connection and refresh. ({error})</Alert>}
        {!data && !error && <PageLoader />}

        {data && (
          <>
            <nav className="no-scrollbar sticky top-[calc(65px+env(safe-area-inset-top))] z-20 -mx-4 flex gap-2 overflow-x-auto bg-cream/95 px-4 py-3 backdrop-blur" aria-label="Menu categories">
              {sections.map((c) => (
                <a key={c.id} href={`#cat-${c.id}`} className="chip border-coffee-200 bg-white text-coffee-800 hover:border-coffee-500">
                  {c.name}
                </a>
              ))}
            </nav>

            {sections.map((c) => (
              <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-32 pt-4">
                <h2 className="section-title mb-3">{c.name}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {c.items.map((item) => (
                    <MenuCard key={item.id} item={item} canOrder={open} onOpen={() => setActive(item)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--nav-h,0px)] z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] [.has-bottom-nav_&]:pb-3">
          <button onClick={() => setCartOpen(true)} className="btn-primary mx-auto flex w-full max-w-lg justify-between rounded-2xl px-5 py-4 text-lg shadow-xl">
            <span className="flex items-center gap-2">
              <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-cream px-2 text-sm font-bold text-coffee-800">{count}</span>
              View cart
            </span>
            <span className="tabular-nums">{formatPeso(subtotal)}</span>
          </button>
        </div>
      )}

      {data && <ItemSheet item={activeLive} groups={data.groups} canOrder={open} onClose={() => setActive(null)} />}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} soldOutIds={unavailable} canOrder={open} />
    </div>
  );
}

function MenuCard({ item, canOrder, onOpen }: { item: MenuItem; canOrder: boolean; onOpen: () => void }) {
  return (
    <article className={`card flex gap-3 p-3 ${item.is_sold_out ? "opacity-70" : ""}`}>
      <button onClick={onOpen} className="shrink-0" aria-label={`View ${item.name}`}>
        <ItemPhoto src={item.photo_url} alt={item.name} className="h-24 w-24 rounded-2xl" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <button onClick={onOpen} className="text-left">
          <h3 className="font-bold leading-snug">{item.name}</h3>
          {item.description && <p className="line-clamp-2 text-sm text-coffee-700">{item.description}</p>}
        </button>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-lg font-bold tabular-nums">{formatPeso(item.price)}</span>
          {item.is_sold_out ? (
            <Badge tone="red">Sold out</Badge>
          ) : canOrder ? (
            <button onClick={onOpen} className="btn-sage btn-sm px-4" aria-label={`Add ${item.name}`}>
              + Add
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
