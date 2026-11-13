"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { formatPeso, ORDER_TYPE_LABEL, STATUS_LABEL } from "@/lib/format";
import { formatDateTime } from "@/lib/hours";
import { BOOKING_STATUS_LABEL, type BookingStatus } from "@/lib/rentals";
import type { Order } from "@/lib/types";

export interface MyBooking {
  id: string;
  booking_number: string;
  public_token: string;
  pickup_at: string | null;
  start_date: string;
  scooter_name: string;
  status: BookingStatus;
  return_at: string | null;
  end_date: string;
  total: number;
}

/** Café orders and scooter rentals, as two tabs (Activity page). */
export function History({ orders, bookings }: { orders: Order[]; bookings: MyBooking[] }) {
  const [tab, setTab] = useState<"orders" | "rentals">("orders");
  useEffect(() => {
    try {
      if (localStorage.getItem("account-history-tab") === "rentals") setTab("rentals");
    } catch {}
  }, []);
  const pick = (t: "orders" | "rentals") => {
    setTab(t);
    try {
      localStorage.setItem("account-history-tab", t);
    } catch {}
  };
  const tabs = [
    { id: "orders" as const, label: "Orders", count: orders.length },
    { id: "rentals" as const, label: "Scooter rentals", count: bookings.length },
  ];
  return (
    <section className="card p-5" data-testid="history">
      <h2 className="section-title mb-3">My activity</h2>
      <div role="tablist" aria-label="My activity" className="grid grid-cols-2 gap-2 rounded-2xl bg-coffee-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => pick(t.id)}
            className={`min-h-[44px] rounded-xl font-semibold ${tab === t.id ? "bg-white shadow" : "text-coffee-700"}`}
          >
            {t.label} <span className="tabular-nums text-coffee-600">({t.count})</span>
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        <div role="tabpanel" id="panel-orders" aria-labelledby="tab-orders" className="mt-3" data-testid="history-orders">
          {orders.length === 0 ? (
            <p className="py-3 text-coffee-700">
              No orders yet.{" "}
              <Link href="/menu" className="font-semibold underline">
                Browse the menu
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-coffee-100">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/order/${o.public_token}`} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-bold">{o.order_number}</p>
                      <p className="text-sm text-coffee-700">
                        {formatDateTime(o.created_at)} · {ORDER_TYPE_LABEL[o.order_type]}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatPeso(o.total)}</p>
                      <Badge tone={o.status === "cancelled" ? "red" : o.status === "completed" ? "green" : "amber"}>{STATUS_LABEL[o.status]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="panel-rentals" aria-labelledby="tab-rentals" className="mt-3" data-testid="history-rentals">
          {bookings.length === 0 ? (
            <p className="py-3 text-coffee-700">
              No scooter rentals yet.{" "}
              <Link href="/baybayin" className="font-semibold underline">
                Book a scooter
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-coffee-100">
              {bookings.map((b) => (
                <li key={b.id}>
                  <Link href={`/baybayin/booking/${b.public_token}`} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-bold">
                        {b.booking_number} · {b.scooter_name}
                      </p>
                      <p className="text-sm text-coffee-700">
                        {b.pickup_at ? formatDateTime(b.pickup_at) : b.start_date} → {b.return_at ? formatDateTime(b.return_at) : b.end_date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatPeso(b.total)}</p>
                      <Badge tone={b.status === "cancelled" ? "red" : b.status === "returned" ? "green" : "amber"}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
