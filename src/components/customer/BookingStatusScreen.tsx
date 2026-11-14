"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StoreHeader } from "./Header";
import { GcashFallback } from "./GcashFallback";
import { Alert, Badge, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";
import { BOOKING_STATUS_LABEL, prettyDateTime, useRentalSettings, type BookingStatus } from "@/lib/rentals";

interface PublicBooking {
  booking_number: string;
  status: BookingStatus;
  payment_status: string;
  payment_method: string | null;
  gcash_reference: string | null;
  scooter_name: string;
  customer_name: string;
  pickup_at: string;
  return_at: string;
  days: number;
  daily_rate: number;
  helmets: number;
  with_driver?: boolean;
  driver_fee?: number;
  vehicle_type?: "scooter" | "car" | null;
  delivery: boolean;
  delivery_address: string | null;
  delivery_fee: number;
  total: number;
  deposit_amount: number;
  security_deposit: number;
  cancel_reason: string | null;
  payment_expires_at: string | null;
  excess_hours: number;
  excess_fee: number;
  security_upfront: boolean;
  pay_now: number | null;
}

/** A customer's booking, by its secret link. GCash: shows whether staff have checked it. Online: confirms with HitPay on return, offers Pay now. */
export function BookingStatusScreen({ token }: { token: string }) {
  const { settings, open } = useStoreSettings();
  const rs = useRentalSettings();
  const params = useSearchParams();
  const [b, setB] = useState<PublicBooking | null | undefined>(undefined);
  const [verifying, setVerifying] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const { data } = await getSupabase().rpc("get_booking_by_token", { p_token: token });
    setB((data as PublicBooking) ?? null);
    return data as PublicBooking | null;
  }, [token]);

  useEffect(() => {
    let stop = false;
    (async () => {
      const first = await load();
      // back from HitPay: confirm with HitPay (the webhook may be a few seconds behind)
      if (params.get("paid") && first?.payment_status === "awaiting_payment") {
        setVerifying(true);
        const tries = params.get("status") === "completed" ? 10 : 2;
        for (let i = 0; i < tries && !stop; i++) {
          const r = await fetch("/api/rentals/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then((x) => x.json()).catch(() => ({}));
          const next = await load();
          if (r.outcome === "paid" || r.outcome === "already_paid" || next?.payment_status !== "awaiting_payment") break;
          if (i < tries - 1) await new Promise((res) => setTimeout(res, 3000));
        }
        setVerifying(false);
      }
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, params, token]);

  const payNow = async () => {
    setPaying(true);
    setError(null);
    const res = await fetch("/api/rentals/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) {
      window.location.href = j.url;
      return;
    }
    setError(j.error ?? "We couldn't open the payment page. Please try again.");
    setPaying(false);
    load();
  };

  if (b === undefined) return <PageLoader />;
  const header = <StoreHeader settings={settings} open={open} brand="baybayin" back="/baybayin" />;
  if (!b)
    return (
      <div className="min-h-screen">
        {header}
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">Booking not found</h1>
          <p className="mt-2 text-coffee-700">Please check the link.</p>
          <Link href="/baybayin" className="btn-primary mt-6">
            Book a scooter
          </Link>
        </main>
      </div>
    );

  const paid = ["deposit_paid", "paid"].includes(b.payment_status);
  const checking = b.payment_status === "for_verification" && b.status === "awaiting_deposit";
  const unpaidOnline = b.payment_method === "online" && b.payment_status === "awaiting_payment" && b.status === "awaiting_deposit" && !verifying;
  const left = b.payment_expires_at ? Math.max(0, new Date(b.payment_expires_at).getTime() - now) : 0;
  const label = checking ? "Checking your GCash payment" : BOOKING_STATUS_LABEL[b.status];

  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <section className="card p-5 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-coffee-600">Booking</p>
          <p className="font-display text-4xl font-bold" data-testid="booking-number">
            {b.booking_number}
          </p>
          <p className="mt-2">
            <Badge tone={b.status === "cancelled" ? "red" : b.status === "awaiting_deposit" ? "amber" : "green"}>{label}</Badge>
          </p>
          {b.status === "confirmed" && <p className="mt-3 text-lg font-semibold text-sage-700">You&apos;re booked! Deposit received ✓</p>}
          {b.status === "picked_up" && <p className="mt-3 text-lg">Enjoy the ride! 🛵</p>}
          {b.status === "returned" && <p className="mt-3 text-lg">Thanks for riding with us!</p>}
        </section>

        {verifying && (
          <p className="flex items-center justify-center gap-2 text-coffee-700">
            <Spinner /> Confirming your payment…
          </p>
        )}
        {unpaidOnline && (
          <section className="card space-y-3 p-5">
            <Alert tone="amber">
              <p className="text-base font-bold">Complete your deposit</p>
              <p className="font-normal">
                Pay {formatPeso(b.pay_now ?? b.deposit_amount)} within {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} to keep this booking. After that, the scooter is released for others.
              </p>
            </Alert>
            <button className="btn-primary w-full" onClick={payNow} disabled={paying || left === 0}>
              {paying ? <Spinner /> : `Pay ${formatPeso(b.pay_now ?? b.deposit_amount)} now`}
            </button>
            {error && <Alert>{error}</Alert>}
            {left > 0 && <GcashFallback token={token} amount={Number(b.pay_now ?? b.deposit_amount)} folder="proofs/rentals" endpoint="/api/rentals/switch-to-gcash" onDone={load} />}
          </section>
        )}
        {checking && (
          <Alert tone="amber">
            <p className="text-base font-bold">We&apos;re checking your GCash payment</p>
            <p className="font-normal">
              Your scooter is held for you while our staff confirm your {formatPeso(b.pay_now ?? b.deposit_amount)} payment
              {b.gcash_reference ? ` (ref. ${b.gcash_reference})` : ""}. This page updates by itself once it&apos;s confirmed.
            </p>
          </Alert>
        )}
        {b.status === "cancelled" && (
          <Alert>
            <p className="font-bold">This booking is cancelled.</p>
            {b.cancel_reason && <p className="font-normal">{b.cancel_reason}</p>}
            {b.payment_status === "refunded" && <p className="font-normal">{b.payment_method === "online" ? "Your deposit has been refunded." : "Your deposit has been sent back to you."}</p>}
          </Alert>
        )}

        <section className="card space-y-2 p-5 text-sm">
          <h2 className="section-title mb-1">Details</h2>
          <p>
            <strong>{b.scooter_name}</strong> ·{" "}
            {b.vehicle_type === "car" ? (b.with_driver ? "with our driver" : "self-drive") : b.helmets === 0 ? "no helmet" : `${b.helmets} helmet${b.helmets > 1 ? "s" : ""}`}
          </p>
          <p data-testid="booking-times">
            <strong>Pickup:</strong> {prettyDateTime(b.pickup_at)}
            <br />
            <strong>Return by:</strong> {prettyDateTime(b.return_at)} · {b.days} day{b.days === 1 ? "" : "s"}
          </p>
          <p>{b.delivery ? `Delivery to: ${b.delivery_address}` : `Pickup${rs?.pickup_note ? `: ${rs.pickup_note}` : ""}`}</p>
          <dl className="space-y-1 border-t border-coffee-100 pt-2">
            <div className="flex justify-between">
              <dt>
                {b.days} day{b.days === 1 ? "" : "s"} × {formatPeso(b.daily_rate)}
              </dt>
              <dd>{formatPeso(b.days * Number(b.daily_rate))}</dd>
            </div>
            {Number(b.excess_hours) > 0 && (
              <div className="flex justify-between">
                <dt>Extra {b.excess_hours} hour{b.excess_hours === 1 ? "" : "s"}</dt>
                <dd>{formatPeso(b.excess_fee)}</dd>
              </div>
            )}
            {b.with_driver && Number(b.driver_fee) > 0 && (
              <div className="flex justify-between" data-testid="status-driver-fee">
                <dt>Driver</dt>
                <dd>{formatPeso(Number(b.driver_fee))}</dd>
              </div>
            )}
            {b.delivery && (
              <div className="flex justify-between">
                <dt>Delivery</dt>
                <dd>{formatPeso(b.delivery_fee)}</dd>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <dt>Total rental</dt>
              <dd>{formatPeso(b.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>
                {b.security_upfront ? "Deposit + security deposit" : "Deposit"}{" "}
                {paid ? (b.payment_method === "online" ? "paid online" : "paid") : b.payment_status === "for_verification" ? "sent by GCash (being checked)" : "(not paid yet)"}
              </dt>
              <dd data-testid="paid-now">{formatPeso(b.pay_now ?? b.deposit_amount)}</dd>
            </div>
            {b.status !== "cancelled" && (
              <div className="flex justify-between">
                <dt>Rental balance</dt>
                <dd data-testid="balance">{formatPeso(Number(b.total) - Number(b.deposit_amount))}</dd>
              </div>
            )}
            {Number(b.security_deposit) > 0 && !b.security_upfront && b.status !== "cancelled" && b.status !== "returned" && (
              <div className="flex justify-between">
                <dt>
                  Security deposit at pickup <span className="text-coffee-600">(refundable)</span>
                </dt>
                <dd>{formatPeso(b.security_deposit)}</dd>
              </div>
            )}
            {b.status !== "cancelled" && b.status !== "returned" && (
              <div className="flex justify-between border-t border-coffee-100 pt-1 font-bold">
                <dt>Total balance at pickup</dt>
                <dd data-testid="due-at-pickup">{formatPeso(Number(b.total) - Number(b.deposit_amount) + (b.security_upfront ? 0 : Number(b.security_deposit)))}</dd>
              </div>
            )}
          </dl>
          {Number(b.security_deposit) > 0 && b.status !== "cancelled" && b.status !== "returned" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">
              The {formatPeso(b.security_deposit)} security deposit{rs?.security_deposit_note ? ` (${rs.security_deposit_note})` : ""} is refunded when the scooter comes back in good condition.
            </p>
          )}
          {b.status !== "cancelled" && b.status !== "returned" && <p className="text-coffee-700">Bring your driver&apos;s license when you pick up the scooter.</p>}
        </section>
        <p className="text-center text-sm font-semibold text-coffee-800" data-testid="screenshot-note">
          📸 Take a screenshot of this page and present it upon pickup.
        </p>
        <Link href="/" className="btn-secondary w-full">
          Back to home
        </Link>
      </main>
    </div>
  );
}
