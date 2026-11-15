"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { Alert, Badge, PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { addDaysYmd, clock, prettyYmd, STAY_STATUS_LABEL, type StayStatus } from "@/lib/stays";

interface PublicStay {
  booking_number: string;
  status: StayStatus;
  payment_status: string;
  room_name: string;
  property_name: string;
  customer_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  total: number;
  deposit_amount: number;
  cancel_reason: string | null;
  check_in_time: string;
  check_out_time: string;
  location_text: string | null;
  map_url: string | null;
  free_cancel_days: number;
}

/** A customer's stay, by its secret link. Updates live when staff confirm the deposit. */
export function StayBookingScreen({ token }: { token: string }) {
  const { settings, open } = useStoreSettings();
  const [b, setB] = useState<PublicStay | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data } = await getSupabase().rpc("get_stay_booking", { p_token: token });
    setB((data as PublicStay) ?? null);
  }, [token]);
  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  if (b === undefined) return <PageLoader />;
  const header = <StoreHeader settings={settings} open={open} brand="site" back="/stays" />;
  if (!b)
    return (
      <div className="min-h-screen">
        {header}
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">Booking not found</h1>
          <p className="mt-2 text-coffee-700">Please check the link.</p>
          <Link href="/stays" className="btn-primary mt-6">
            See stays
          </Link>
        </main>
      </div>
    );

  const checking = b.status === "awaiting_deposit";
  const cancelBy = addDaysYmd(b.check_in, -b.free_cancel_days);
  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <section className="card p-5 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-coffee-600">Stay</p>
          <p className="font-display text-4xl font-bold" data-testid="stay-number">
            {b.booking_number}
          </p>
          <p className="mt-2" data-testid="stay-status">
            <Badge tone={b.status === "cancelled" ? "red" : checking ? "amber" : "green"}>{STAY_STATUS_LABEL[b.status]}</Badge>
          </p>
          {b.status === "confirmed" && <p className="mt-3 text-lg font-semibold text-sage-700">You&apos;re booked! Deposit received ✓</p>}
          {b.status === "checked_in" && <p className="mt-3 text-lg">Enjoy your stay! 🏝️</p>}
          {b.status === "checked_out" && <p className="mt-3 text-lg">Thanks for staying with us!</p>}
        </section>
        {checking && (
          <Alert tone="amber">
            <p className="text-base font-bold">We&apos;re checking your GCash deposit</p>
            <p className="font-normal">Your room is held for you while our staff confirm your {formatPeso(b.deposit_amount)} deposit. This page updates by itself.</p>
          </Alert>
        )}
        {b.status === "cancelled" && (
          <Alert>
            <p className="font-bold">This stay is cancelled.</p>
            {b.cancel_reason && <p className="font-normal">{b.cancel_reason}</p>}
            {b.payment_status === "refunded" && <p className="font-normal">Your deposit has been sent back to you.</p>}
          </Alert>
        )}
        <section className="card space-y-2 p-5 text-sm" data-testid="stay-details">
          <h2 className="section-title mb-1">Details</h2>
          <p>
            <strong>{b.room_name}</strong> · {b.property_name}
          </p>
          {b.location_text && (
            <p>
              📍 {b.location_text}
              {b.map_url && (
                <>
                  {" "}
                  ·{" "}
                  <a href={b.map_url} target="_blank" rel="noreferrer" className="font-semibold text-orange-700 underline">
                    Maps
                  </a>
                </>
              )}
            </p>
          )}
          <p>
            <strong>Check-in:</strong> {prettyYmd(b.check_in)}, from {clock(b.check_in_time)}
            <br />
            <strong>Check-out:</strong> {prettyYmd(b.check_out)}, by {clock(b.check_out_time)}
            <br />
            {b.nights} night{b.nights === 1 ? "" : "s"} · {b.guests} guest{b.guests === 1 ? "" : "s"}
          </p>
          <dl className="space-y-1 border-t border-coffee-100 pt-2">
            <div className="flex justify-between font-bold">
              <dt>Total</dt>
              <dd>{formatPeso(b.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Deposit (GCash)</dt>
              <dd>{formatPeso(b.deposit_amount)}</dd>
            </div>
            <div className="flex justify-between" data-testid="stay-balance">
              <dt>Balance at check-in</dt>
              <dd>{formatPeso(b.payment_status === "paid" ? 0 : Number(b.total) - Number(b.deposit_amount))}</dd>
            </div>
          </dl>
          {b.status !== "cancelled" && b.status !== "checked_out" && (
            <p className="rounded-xl bg-orange-50 px-3 py-2 text-orange-900">
              Free cancellation until {prettyYmd(cancelBy)}. To cancel or change your dates, message us{settings?.contact_phone ? ` at ${settings.contact_phone}` : ""}.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
