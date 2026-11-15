"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SelectedOption } from "./types";

export interface CartLine {
  key: string;
  menu_item_id: string;
  name: string;
  photo_url: string | null;
  base_price: number;
  options: SelectedOption[];
  unit_price: number;
  quantity: number;
  notes: string;
  store_slug?: string; // food store (missing on old carts = Pahuway Cafe)
  store_name?: string;
}

interface CartCtx {
  lines: CartLine[];
  count: number;
  subtotal: number;
  ready: boolean;
  /** the store this cart is from (one store per cart) */
  store: { slug: string; name: string } | null;
  add: (line: Omit<CartLine, "key">) => void;
  setQty: (key: string, qty: number) => void;
  setNotes: (key: string, notes: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const Ctx = createContext<CartCtx | null>(null);
const STORAGE_KEY = "pahuway-cart-v1";

const lineKey = (l: Pick<CartLine, "menu_item_id" | "options" | "notes">) =>
  [l.menu_item_id, ...l.options.map((o) => o.id).sort(), l.notes.trim().toLowerCase()].join("|");

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {}
  }, [lines, ready]);

  const add = useCallback((line: Omit<CartLine, "key">) => {
    const key = lineKey(line);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l));
      return [...prev, { ...line, key }];
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, qty) } : l))));
  }, []);

  const setNotes = useCallback((key: string, notes: string) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, notes: notes.slice(0, 200) } : l)));
  }, []);

  const remove = useCallback((key: string) => setLines((prev) => prev.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({
      lines,
      ready,
      store: lines.length ? { slug: lines[0].store_slug ?? "pahuway-cafe", name: lines[0].store_name ?? "Pahuway Cafe" } : null,
      count: lines.reduce((s, l) => s + l.quantity, 0),
      subtotal: lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),
      add,
      setQty,
      setNotes,
      remove,
      clear,
    }),
    [lines, ready, add, setQty, setNotes, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}

/** Recent guest orders, so a customer can find their tracking link again. */
const RECENT_KEY = "pahuway-recent-orders";
export interface RecentOrder {
  token: string;
  order_number: string;
  created_at: string;
}
export function saveRecentOrder(o: RecentOrder) {
  try {
    const list: RecentOrder[] = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    localStorage.setItem(RECENT_KEY, JSON.stringify([o, ...list.filter((x) => x.token !== o.token)].slice(0, 5)));
  } catch {}
}
export function getRecentOrders(): RecentOrder[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}
