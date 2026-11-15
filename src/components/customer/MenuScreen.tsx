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
import { MAIN_STORE, storeHours, storeOpenNow, storePrep, useStores } from "@/lib/stores";

/** A store's menu. Pahuway Cafe is /menu (its Settings hours, greeting); other stores are /food/<slug>. */
export function MenuScreen({ slug = MAIN_STORE }: { slug?: string }) {
  const stores = useStores();
  const store = stores?.find((x) => x.slug === slug) ?? null;
  const isMain = slug === MAIN_STORE;
  const { data, error } = useMenu(store ? store.id : stores ? (isMain ? undefined : null) : null);
  const { settings, open: cafeOpen } = useStoreSettings();
  const open = isMain ? cafeOpen : storeOpenNow(store, settings);
  const { count, subtotal, lines, store: cartStore } = useCart();
  const otherCart = !!cartStore && cartStore.slug !== slug;
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
    lines.forEach((l) => (l.store_slug ?? MAIN_STORE) === slug && !ids.has(l.menu_item_id) && s.add(l.menu_item_id));
    return s;
  }, [data, soldOutIds, lines]);

  const sections = useMemo(
    () => (data ? data.categories.map((c) => ({ ...c, items: data.items.filter((i) => i.category_id === c.id) })).filter((c) => c.items.length) : []),
    [data],
  );

  // opened from a listing card (/menu?item=…): open that item straight away
  useEffect(() => {
    if (!data) return;
    const id = new URLSearchParams(window.location.search).get("item");
    const item = id ? data.items.find((i) => i.id === id) : null;
    if (item) setActive(item);
  }, [data]);

  // opened from a "What are you craving?" shortcut (/menu#cat-…): jump to that category once the menu has loaded
  const hasMenu = !!data;
  useEffect(() => {
    if (!hasMenu || !window.location.hash.startsWith("#cat-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50);
  }, [hasMenu]);

  return (
    <div className="min-h-screen pb-28">
      {isMain ? <StoreHeader settings={settings} open={open} /> : <StoreHeader settings={settings} open={open} brand="site" back="/food" />}

      <main className="mx-auto max-w-5xl px-4">
        {!isMain && stores && !store && (
          <section className="card my-6 p-6 text-center" data-testid="store-missing">
            <p className="font-bold">This store isn&apos;t on Padaya right now.</p>
            <Link href="/food" className="btn-primary mt-3 inline-flex">
              See all food stores
            </Link>
          </section>
        )}
        {!isMain && store && (
          <section className="flex items-center gap-4 py-5" data-testid="store-head">
            {store.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.logo_url} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            ) : (
              <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-4xl">
                {store.emoji}
              </span>
            )}
            <div className="min-w-0">
              <h1 data-testid="menu-greeting" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
                {store.name}
              </h1>
              {store.tagline && <p className="text-coffee-700">{store.tagline}</p>}
              <p className="text-sm font-medium text-coffee-600">
                📍 {store.town} · {storeHours(store, settings)} · ~{storePrep(store, settings)} min
              </p>
            </div>
          </section>
        )}
        {isMain && (
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
        )}

        {otherCart && (
          <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="other-cart">
            Your cart has items from <strong>{cartStore!.name}</strong>. Adding from here starts a new cart — one store per order.
          </p>
        )}

        {isMain && settings && !open && (
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

        {!isMain && store && settings && !open && (
          <div className="mb-4">
            <Alert tone="amber">
              <p className="font-bold">{store.name} is closed right now.</p>
              <p className="font-normal">Ordering opens at {storeHours(store, settings).split(" – ")[0]}.</p>
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
        {!data && !error && (isMain || !stores || store) && <PageLoader />}

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
                    <MenuCard key={item.id} item={item} canOrder={open} onOpen={() => setActive(item)} emoji={store?.emoji} />
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
              View cart{otherCart ? ` · ${cartStore!.name}` : ""}
            </span>
            <span className="tabular-nums">{formatPeso(subtotal)}</span>
          </button>
        </div>
      )}

      {data && <ItemSheet item={activeLive} groups={data.groups} canOrder={open} onClose={() => setActive(null)} store={store ? { slug: store.slug, name: store.name } : { slug: MAIN_STORE, name: "Pahuway Cafe" }} />}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} soldOutIds={unavailable} canOrder={otherCart || open} />
    </div>
  );
}

function MenuCard({ item, canOrder, onOpen, emoji }: { item: MenuItem; canOrder: boolean; onOpen: () => void; emoji?: string }) {
  return (
    <article className={`card flex gap-3 p-3 ${item.is_sold_out ? "opacity-70" : ""}`}>
      <button onClick={onOpen} className="shrink-0" aria-label={`View ${item.name}`}>
        <ItemPhoto src={item.photo_url} alt={item.name} className="h-24 w-24 rounded-2xl" emoji={emoji} />
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
