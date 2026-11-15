"use client";
import { MAIN_STORE, useStores } from "@/lib/stores";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, PageLoader } from "@/components/ui";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";
import { formatPeso, ORDER_TYPE_LABEL, timeAgo } from "@/lib/format";
import { formatTime, storeNow } from "@/lib/hours";
import { playChime, unlockAudio } from "@/lib/sound";
import type { Order, OrderStatus, Rider } from "@/lib/types";
import { OrderDetail } from "./OrderDetail";

const COLUMNS: { key: string; title: string; statuses: OrderStatus[]; tone: string }[] = [
  { key: "new", title: "New", statuses: ["received"], tone: "border-t-amber-500" },
  { key: "preparing", title: "Preparing", statuses: ["preparing"], tone: "border-t-coffee-500" },
  { key: "ready", title: "Ready", statuses: ["ready"], tone: "border-t-sage-500" },
  { key: "out", title: "Out for delivery", statuses: ["out_for_delivery"], tone: "border-t-sky-600" },
];

function startOfStoreDay(): string {
  const { minutes, seconds } = storeNow();
  return new Date(Date.now() - (minutes * 60 + seconds) * 1000).toISOString();
}

export function OrdersBoard() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState("new");
  const stores = useStores(true);
  const [storeFilter, setStoreFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [live, setLive] = useState(false);
  const soundRef = useRef(false);
  soundRef.current = soundOn;
  const [, tick] = useState(0);

  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIds.current = new Set((orders ?? []).map((o) => o.id));
  }, [orders]);

  const addNewOrder = useCallback(async (id: string, alert: boolean) => {
    const { data } = await getSupabase().from("orders").select("*, order_items(*)").eq("id", id).single();
    if (!data || (data as Order).payment_status === "awaiting_payment") return;
    setOrders((prev) => (prev ? [...prev.filter((o) => o.id !== id), data as Order] : [data as Order]));
    if (!alert) return;
    setFresh((s) => new Set(s).add(id));
    setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(id); return n; }), 8000);
    if (soundRef.current) playChime();
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .or(`status.in.(received,preparing,ready,out_for_delivery),created_at.gte.${startOfStoreDay()}`)
      .neq("payment_status", "awaiting_payment") // unpaid online checkouts stay hidden until paid
      .order("created_at", { ascending: true });
    if (error) return setError(error.message);
    setError(null);
    setOrders(data as Order[]);
  }, []);

  useEffect(() => {
    load();
    let cancelled = false;
    let ch: ReturnType<ReturnType<typeof getSupabase>["channel"]> | null = null;
    const supabase = getSupabase();
    supabase
      .from("riders")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setRiders((data as Rider[]) ?? []));

    // Join the realtime channel only once it carries the staff login — joining as
    // anonymous would make row-level security drop every order event.
    getAuthedSupabase().then((sb) => {
      if (cancelled) return;
      ch = sb
        .channel("admin-orders")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, async (p) => {
          const row = p.new as Order;
          if (row.payment_status === "awaiting_payment") return; // wait for the payment
          await addNewOrder(row.id, true);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, async (p) => {
          const row = p.new as Order;
          if (row.payment_status === "awaiting_payment") return;
          const known = knownIds.current.has(row.id);
          if (!known) {
            const switchedToGcash = row.payment_method === "gcash" && row.payment_status === "for_verification" && row.status !== "cancelled";
            if (row.payment_method !== "online" && !switchedToGcash) return; // only paid online orders or ones switched to GCash become newly visible
            // an online order just got paid (or a late payment on a cancelled one) → show it now
            await addNewOrder(row.id, row.status !== "cancelled");
            return;
          }
          setOrders((prev) => prev?.map((o) => (o.id === row.id ? { ...o, ...row, order_items: o.order_items } : o)) ?? prev);
        })
        .subscribe((status) => {
          setLive(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") load(); // catch anything missed while reconnecting
        });
    });
    // keep the realtime token fresh through long shifts
    const { data: authSub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      authSub.subscription.unsubscribe();
      if (ch) supabase.removeChannel(ch);
    };
  }, [load, addNewOrder]);

  const newCount = orders?.filter((o) => o.status === "received").length ?? 0;

  // Keep reminding while orders are waiting to be accepted
  useEffect(() => {
    document.title = newCount ? `(${newCount}) New order${newCount > 1 ? "s" : ""} · Pahuway` : "Orders · Pahuway Staff";
    if (!soundOn || newCount === 0) return;
    const t = setInterval(playChime, 30_000);
    return () => clearInterval(t);
  }, [newCount, soundOn]);

  const shownOrders = useMemo(() => (orders ?? []).filter((o) => storeFilter === "all" || o.business_id === storeFilter), [orders, storeFilter]);
  const byColumn = useMemo(() => {
    const m: Record<string, Order[]> = {};
    for (const c of COLUMNS) m[c.key] = shownOrders.filter((o) => c.statuses.includes(o.status));
    return m;
  }, [shownOrders]);
  const done = shownOrders.filter((o) => o.status === "completed" || o.status === "cancelled").reverse();
  const storeName = (id?: string | null) => {
    const st = stores?.find((x) => x.id === id);
    return st && st.slug !== MAIN_STORE ? st.name : null;
  };
  const selected = orders?.find((o) => o.id === selectedId) ?? null;

  if (!orders && !error) return <PageLoader />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold">Orders</h1>
          {stores && stores.length > 1 && (
            <select aria-label="Store" className="input !w-auto !py-1.5 text-sm" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} data-testid="store-filter">
              <option value="all">All stores</option>
              {stores.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          )}
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${live ? "text-sage-700" : "text-red-700"}`}>
            <span className={`h-2 w-2 rounded-full ${live ? "bg-sage-500" : "bg-red-600"}`} aria-hidden />
            {live ? "Live" : "Reconnecting…"}
          </span>
        </div>
        <button
          onClick={async () => {
            if (soundOn) return setSoundOn(false);
            const ok = await unlockAudio();
            setSoundOn(ok);
            if (ok) playChime();
          }}
          className={soundOn ? "btn-sage btn-sm" : "btn-primary btn-sm animate-pulse"}
        >
          {soundOn ? "🔔 Sound on" : "🔕 Tap to turn on order sound"}
        </button>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* Phone: tabs. Tablet and up: columns side by side. */}
      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 md:hidden" role="tablist">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={tab === c.key}
            onClick={() => setTab(c.key)}
            className={`chip ${tab === c.key ? "border-coffee-800 bg-coffee-800 text-cream" : "border-coffee-200 bg-white"}`}
          >
            {c.title}
            <span className={`ml-2 rounded-full px-2 text-xs ${c.key === "new" && byColumn[c.key].length ? "bg-amber-500 text-white" : "bg-coffee-100 text-coffee-800"}`}>
              {byColumn[c.key].length}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((c) => (
          <section key={c.key} className={`${tab === c.key ? "block" : "hidden"} rounded-3xl border-t-4 bg-white/60 p-2 md:block ${c.tone}`}>
            <h2 className="flex items-center justify-between px-2 py-2 font-bold">
              {c.title}
              <span className="rounded-full bg-coffee-100 px-2.5 text-sm">{byColumn[c.key].length}</span>
            </h2>
            <div className="space-y-2">
              {byColumn[c.key].length === 0 && <p className="px-2 py-6 text-center text-sm text-coffee-500">Nothing here</p>}
              {byColumn[c.key].map((o) => (
                <OrderCard key={o.id} order={o} fresh={fresh.has(o.id)} riders={riders} store={storeName(o.business_id)} onOpen={() => setSelectedId(o.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-3xl bg-white/60 p-2">
        <button className="flex w-full items-center justify-between px-2 py-2 font-bold" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
          <span>Completed &amp; cancelled today ({done.length})</span>
          <span aria-hidden>{showDone ? "▲" : "▼"}</span>
        </button>
        {showDone && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {done.map((o) => (
              <OrderCard key={o.id} order={o} riders={riders} store={storeName(o.business_id)} onOpen={() => setSelectedId(o.id)} />
            ))}
          </div>
        )}
      </section>

      <OrderDetail order={selected} riders={riders} store={storeName(selected?.business_id)} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function OrderCard({ order: o, fresh, riders, onOpen, store }: { order: Order; fresh?: boolean; riders: Rider[]; onOpen: () => void; store?: string | null }) {
  const items = o.order_items ?? [];
  const rider = riders.find((r) => r.id === o.rider_id);
  return (
    <button onClick={onOpen} className={`card block w-full p-3 text-left transition hover:ring-2 hover:ring-coffee-300 ${fresh ? "animate-new-order ring-2 ring-sage-500" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold leading-tight">{o.order_number}</p>
          <p className="text-sm text-coffee-700">{o.customer_name}</p>
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums">{formatPeso(o.total)}</p>
          <p className="text-xs text-coffee-600">{timeAgo(o.created_at)}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {store && (
          <span data-testid="order-store-badge" className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-800">
            {store}
          </span>
        )}
        <Badge tone={o.order_type === "delivery" ? "blue" : o.order_type === "dine_in" ? "brown" : "gray"}>{ORDER_TYPE_LABEL[o.order_type]}</Badge>
        {o.scheduled_for ? <Badge tone="amber">⏰ {formatTime(o.scheduled_for)}</Badge> : <Badge tone="gray">ASAP</Badge>}
        {o.payment_method === "gcash" && <Badge tone={o.payment_status === "paid" ? "green" : "red"}>{o.payment_status === "paid" ? "GCash ✓" : "GCash – verify"}</Badge>}
        {o.payment_method === "online" &&
          (o.status === "cancelled" && o.payment_status === "paid" ? (
            <Badge tone="red">Refund needed</Badge>
          ) : (
            <Badge tone={o.payment_status === "refunded" ? "gray" : "green"}>{o.payment_status === "refunded" ? "Refunded" : "Paid online ✓"}</Badge>
          ))}
        {o.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
        {o.order_type === "delivery" && o.status !== "cancelled" && o.status !== "completed" && (
          <Badge tone={rider ? "green" : "amber"}>{rider ? `🛵 ${rider.name.split(" ")[0]}` : "No rider"}</Badge>
        )}
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {items.slice(0, 4).map((i) => (
          <li key={i.id} className="truncate">
            <span className="font-semibold">{i.quantity}×</span> {i.item_name}
            {i.options.length > 0 && <span className="text-coffee-600"> · {i.options.map((x) => x.name).join(", ")}</span>}
          </li>
        ))}
        {items.length > 4 && <li className="text-coffee-600">+{items.length - 4} more…</li>}
      </ul>
    </button>
  );
}
