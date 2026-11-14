"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { formatPeso, ORDER_TYPE_LABEL, STATUS_LABEL } from "@/lib/format";
import { formatDateTime } from "@/lib/hours";
import { BOOKING_STATUS_LABEL, type BookingStatus } from "@/lib/rentals";
import { prettyYmd, STAY_STATUS_LABEL, type StayStatus } from "@/lib/stays";
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

export interface MyStay {
  id: string;
  booking_number: string;
  public_token: string;
  room_name: string;
  property_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  total: number;
  status: StayStatus;
}
type HTab = "orders" | "rentals" | "stays";

/** Café orders, scooter & car rentals and stays, as tabs (Activity page). */
export function History({ orders, bookings, stays = [] }: { orders: Order[]; bookings: MyBooking[]; stays?: MyStay[] }) {
  const [tab, setTab] = useState<HTab>("orders");
  useEffect(() => {
    try {
      const t = localStorage.getItem("account-history-tab");
      if (t === "rentals" || t === "stays") setTab(t);
    } catch {}
  }, []);
  const pick = (t: HTab) => {
    setTab(t);
    try {
      localStorage.setItem("account-history-tab", t);
    } catch {}
  };
  const tabs = [
    { id: "orders" as const, label: "Orders", count: orders.length },
    { id: "rentals" as const, label: "Rentals", count: bookings.length },
    { id: "stays" as const, label: "Stays", count: stays.length },
  ];
  return (
    <section className="card p-5" data-testid="history">
      <h2 className="section-title mb-3">My activity</h2>
      <div role="tablist" aria-label="My activity" className="grid grid-cols-3 gap-1 rounded-2xl bg-coffee-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => pick(t.id)}
            className={`min-h-[44px] rounded-xl text-sm font-semibold sm:text-base ${tab === t.id ? "bg-white shadow" : "text-coffee-700"}`}
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
      ) : tab === "stays" ? (
        <div role="tabpanel" id="panel-stays" aria-labelledby="tab-stays" className="mt-3" data-testid="history-stays">
          {stays.length === 0 ? (
            <p className="py-3 text-coffee-700">
              No stays yet.{" "}
              <Link href="/stays" className="font-semibold underline">
                Find a stay
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-coffee-100">
              {stays.map((b) => (
                <li key={b.id}>
                  <Link href={`/stays/booking/${b.public_token}`} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-bold">
                        {b.booking_number} · {b.room_name}
                      </p>
                      <p className="text-sm text-coffee-700">
                        {prettyYmd(b.check_in)} → {prettyYmd(b.check_out)} · {b.nights} night{b.nights === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatPeso(b.total)}</p>
                      <Badge tone={b.status === "cancelled" ? "red" : b.status === "checked_out" ? "green" : "amber"}>{STAY_STATUS_LABEL[b.status] ?? b.status}</Badge>
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
              No rentals yet.{" "}
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
