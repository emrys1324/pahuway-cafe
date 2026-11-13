"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { getRecentOrders, useCart } from "@/lib/cart";
import { formatPeso, STATUS_LABEL } from "@/lib/format";
import { formatDateTime } from "@/lib/hours";
import { BOOKING_STATUS_LABEL, getRecentBooking, type BookingStatus } from "@/lib/rentals";
import type { ItemOption, OrderStatus, SelectedOption } from "@/lib/types";

interface LastOrder {
  id: string;
  order_number: string;
  public_token: string;
  status: OrderStatus;
  total: number;
  created_at: string;
}
interface LastBooking {
  booking_number: string;
  public_token: string;
  status: BookingStatus;
  scooter_name: string;
  pickup_at: string | null;
}

/** Shortcuts under the hero: your latest order (with Order again) and booking; guests get their saved links + a sign-in prompt. */
export function HomeShortcuts() {
  const [state, setState] = useState<{ signedIn: boolean; order: LastOrder | null; booking: LastBooking | null } | null>(null);
  const [guest, setGuest] = useState<{ order: { token: string; number: string } | null; booking: { token: string; number: string } | null }>({ order: null, booking: null });

  useEffect(() => {
    const r = getRecentOrders()[0];
    setGuest({ order: r ? { token: r.token, number: r.order_number } : null, booking: getRecentBooking() });
    const supabase = getSupabase();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setState({ signedIn: false, order: null, booking: null });
      const [o, b] = await Promise.all([
        supabase.from("orders").select("id, order_number, public_token, status, total, created_at").eq("customer_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("rental_bookings").select("booking_number, public_token, status, scooter_name, pickup_at").eq("customer_user_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setState({ signedIn: true, order: (o.data as LastOrder) ?? null, booking: (b.data as LastBooking) ?? null });
    })();
  }, []);

  if (!state) return null;

  if (!state.signedIn) {
    return (
      <section data-testid="shortcuts" className="card space-y-3 p-5">
        {(guest.order || guest.booking) && (
          <div className="flex flex-wrap gap-2">
            {guest.order && (
              <Link href={`/order/${guest.order.token}`} className="btn-secondary btn-sm">
                Your order {guest.order.number} →
              </Link>
            )}
            {guest.booking && (
              <Link href={`/baybayin/booking/${guest.booking.token}`} className="btn-secondary btn-sm">
                Your booking {guest.booking.number} →
              </Link>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-coffee-800">
            <span className="font-semibold">Sign in</span> to track your orders and bookings and order again in one tap.
          </p>
          <Link href="/account" className="btn-primary btn-sm" data-testid="shortcuts-signin">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  if (!state.order && !state.booking) return null;
  return (
    <section data-testid="shortcuts" className="grid gap-3 sm:grid-cols-2">
      {state.order && <OrderShortcut order={state.order} />}
      {state.booking && (
        <Link href={`/baybayin/booking/${state.booking.public_token}`} className="card flex items-center justify-between gap-3 p-4" data-testid="shortcut-booking">
          <div className="min-w-0">
            <p className="text-sm text-coffee-600">Your latest booking</p>
            <p className="font-bold">
              {state.booking.booking_number} · {state.booking.scooter_name}
            </p>
            {state.booking.pickup_at && <p className="text-sm text-coffee-700">Pickup {formatDateTime(state.booking.pickup_at)}</p>}
          </div>
          <Badge tone={state.booking.status === "cancelled" ? "red" : state.booking.status === "returned" ? "green" : "amber"}>{BOOKING_STATUS_LABEL[state.booking.status] ?? state.booking.status}</Badge>
        </Link>
      )}
    </section>
  );
}

function OrderShortcut({ order }: { order: LastOrder }) {
  const router = useRouter();
  const { add } = useCart();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** Puts the same items back in the cart at today's prices; items or options no longer offered are left out. */
  const orderAgain = async () => {
    setBusy(true);
    setNote(null);
    const supabase = getSupabase();
    const { data: lines } = await supabase.from("order_items").select("menu_item_id, quantity, notes, options").eq("order_id", order.id);
    const ids = [...new Set((lines ?? []).map((l) => l.menu_item_id).filter(Boolean))] as string[];
    const [items, groups] = await Promise.all([
      supabase.from("menu_items").select("id, name, price, photo_url, is_sold_out, is_active, menu_item_option_groups(group_id)").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabase.from("option_groups").select("id, name, item_options(*)"),
    ]);
    type Item = { id: string; name: string; price: number; photo_url: string | null; is_sold_out: boolean; is_active: boolean; menu_item_option_groups: { group_id: string }[] };
    type Group = { id: string; name: string; item_options: ItemOption[] };
    const byId = new Map(((items.data ?? []) as Item[]).map((i) => [i.id, i]));
    const groupList = (groups.data ?? []) as Group[];
    let added = 0;
    let skipped = 0;
    for (const l of lines ?? []) {
      const item = l.menu_item_id ? byId.get(l.menu_item_id) : undefined;
      if (!item || !item.is_active || item.is_sold_out) {
        skipped++;
        continue;
      }
      const mine = groupList.filter((g) => item.menu_item_option_groups.some((m) => m.group_id === g.id));
      const picked: SelectedOption[] = [];
      let ok = true;
      for (const o of (l.options ?? []) as { group: string; name: string }[]) {
        const g = mine.find((x) => x.name === o.group);
        const opt = g?.item_options.find((x) => x.name === o.name && x.is_active);
        if (!g || !opt) {
          ok = false;
          break;
        }
        picked.push({ id: opt.id, group: g.name, name: opt.name, price_delta: Number(opt.price_delta) });
      }
      if (!ok) {
        skipped++;
        continue;
      }
      const delta = picked.reduce((s, o) => s + o.price_delta, 0);
      add({ menu_item_id: item.id, name: item.name, photo_url: item.photo_url, base_price: Number(item.price), options: picked, unit_price: Number(item.price) + delta, quantity: l.quantity, notes: l.notes ?? "" });
      added++;
    }
    setBusy(false);
    if (!added) return setNote("Sorry — the items from that order aren't available right now.");
    if (skipped) {
      setNote(`${skipped} item${skipped === 1 ? " isn't" : "s aren't"} available any more, so we left ${skipped === 1 ? "it" : "them"} out.`);
      setTimeout(() => router.push("/checkout"), 1800);
      return;
    }
    router.push("/checkout");
  };

  return (
    <div className="card space-y-3 p-4" data-testid="shortcut-order">
      <Link href={`/order/${order.public_token}`} className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-coffee-600">Your latest order</p>
          <p className="font-bold">
            {order.order_number} · {formatPeso(order.total)}
          </p>
          <p className="text-sm text-coffee-700">{formatDateTime(order.created_at)}</p>
        </div>
        <Badge tone={order.status === "cancelled" ? "red" : order.status === "completed" ? "green" : "amber"}>{STATUS_LABEL[order.status]}</Badge>
      </Link>
      {note && <Alert tone="amber">{note}</Alert>}
      <button type="button" className="btn-secondary btn-sm w-full" onClick={orderAgain} disabled={busy} data-testid="order-again">
        {busy ? <Spinner /> : "Order again"}
      </button>
    </div>
  );
}
