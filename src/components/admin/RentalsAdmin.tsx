"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, PageLoader, Sheet, Spinner, Toggle } from "@/components/ui";
import { ScooterPhoto } from "@/components/customer/ScooterPhoto";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { formatDateTime } from "@/lib/hours";
import { uploadPublicImage } from "@/lib/upload";
import { carSpecs, TIME_SLOTS, hhmm, slotLabel, BOOKING_STATUS_LABEL, PAYMENT_LABEL, addDays, manilaDate, manilaDateOf, monthGrid, monthLabel, prettyDateTime, prettyTime, touchesDay, type BookingStatus, type RentalSettings, type Scooter } from "@/lib/rentals";
import { useStaffAccess } from "./StaffAccess";

interface Booking {
  id: string;
  booking_number: string;
  scooter_id: string;
  with_driver?: boolean;
  driver_fee?: number;
  scooter_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  start_date: string;
  end_date: string;
  pickup_at: string;
  return_at: string;
  days: number;
  daily_rate: number;
  helmets: number;
  delivery: boolean;
  delivery_address: string | null;
  delivery_fee: number;
  total: number;
  deposit_amount: number;
  security_deposit: number;
  security_upfront: boolean;
  pay_now: number | null;
  excess_hours: number;
  excess_fee: number;
  license_path: string | null;
  notes: string | null;
  status: BookingStatus;
  payment_status: string;
  payment_method: string | null;
  gcash_reference: string | null;
  payment_proof_path: string | null;
  terms_agreed_at: string | null;
  payment_expires_at: string | null;
  deposit_paid_at: string | null;
  picked_up_at: string | null;
  returned_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}
type Tab = "bookings" | "calendar" | "scooters" | "settings";
const CANCEL_REASONS = ["GCash payment not received", "Customer cancelled", "Scooter not available (repair)", "No-show at pickup", "Couldn't verify license"];
const SMS_LABEL: Record<string, string> = { confirmed: "Booking confirmed", reminder: "Pickup reminder", cancelled: "Cancelled", refunded: "Deposit refunded", staff_alert: "Staff alert" };

export function RentalsAdmin() {
  const [tab, setTab] = useState<Tab>("bookings");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Baybayin rentals</h1>
        <div role="tablist" aria-label="Rentals" className="flex gap-1 rounded-2xl bg-white p-1 shadow-card">
          {(["bookings", "calendar", "scooters", "settings"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize ${tab === t ? "bg-coffee-800 text-cream" : "text-coffee-700"}`}>
              {t === "scooters" ? "vehicles" : t}
            </button>
          ))}
        </div>
      </div>
      {tab === "bookings" && <BookingsTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "scooters" && <ScootersTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- bookings
function useBookings() {
  const [list, setList] = useState<Booking[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from("rental_bookings").select("*").order("pickup_at").order("created_at");
    setList((data as Booking[]) ?? []);
  }, []);
  useEffect(() => {
    load();
    let ch: ReturnType<ReturnType<typeof getSupabase>["channel"]> | null = null;
    getAuthedSupabase().then((db) => {
      ch = db.channel("rental-bookings-staff").on("postgres_changes", { event: "*", schema: "public", table: "rental_bookings" }, () => load()).subscribe();
    });
    return () => {
      if (ch) getSupabase().removeChannel(ch);
    };
  }, [load]);
  return { list, load };
}

function BookingsTab() {
  const { list, load } = useBookings();
  const [filter, setFilter] = useState<"active" | "awaiting" | "done" | "all">("active");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    // open on "GCash to check" when payments are waiting
    if (list?.some((b) => b.status === "awaiting_deposit" && b.payment_status === "for_verification")) setFilter((f) => (f === "active" ? "awaiting" : f));
  }, [list === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now();
  const expired = (b: Booking) => b.status === "awaiting_deposit" && !!b.payment_expires_at && new Date(b.payment_expires_at).getTime() < now;
  const overdue = (b: Booking) => b.status === "picked_up" && new Date(b.return_at).getTime() < now;
  const shown = useMemo(
    () =>
      (list ?? []).filter((b) =>
        filter === "all"
          ? true
          : filter === "active"
            ? ["confirmed", "picked_up"].includes(b.status)
            : filter === "awaiting"
              ? b.status === "awaiting_deposit" && !expired(b)
              : ["returned", "cancelled"].includes(b.status) || expired(b),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, filter],
  );
  const today = manilaDate();
  const open = list?.find((b) => b.id === openId) ?? null;
  const toCheck = (list ?? []).filter((b) => b.status === "awaiting_deposit" && b.payment_status === "for_verification").length;

  if (!list) return <PageLoader />;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Show">
        {(
          [
            ["active", "Confirmed & on the road"],
            ["awaiting", `GCash to check${toCheck ? ` (${toCheck})` : ""} & unpaid`],
            ["done", "Returned & cancelled"],
            ["all", "All"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === k ? "bg-coffee-800 text-cream" : "bg-white text-coffee-800 shadow-card"}`}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="card p-6 text-center text-coffee-700">No bookings here yet.</p>}
      <ul className="grid gap-2">
        {shown.map((b) => (
          <li key={b.id}>
            <button onClick={() => setOpenId(b.id)} className="card flex w-full flex-wrap items-center gap-3 p-4 text-left" data-testid="booking-row">
              <span className="font-mono font-bold">{b.booking_number}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {b.customer_name} · {b.scooter_name}
                </span>
                <span className="block text-sm text-coffee-700">
                  {prettyDateTime(b.pickup_at)} → {prettyDateTime(b.return_at)} · {b.days}d{b.delivery ? " · delivery" : ""}
                  {manilaDateOf(b.pickup_at) === today && b.status === "confirmed" && <strong className="text-sage-700"> · pickup today at {prettyTime(b.pickup_at)}</strong>}
                  {manilaDateOf(b.return_at) === today && b.status === "picked_up" && !overdue(b) && <strong className="text-amber-800"> · due back today at {prettyTime(b.return_at)}</strong>}
                </span>
              </span>
              {overdue(b) && <Badge tone="red">Overdue</Badge>}
              <Badge tone={b.status === "cancelled" || expired(b) ? "red" : b.status === "awaiting_deposit" ? "amber" : b.status === "picked_up" ? "blue" : "green"}>
                {expired(b) ? "Expired" : b.status === "awaiting_deposit" ? (b.payment_status === "for_verification" ? "GCash to check" : "Paying online…") : BOOKING_STATUS_LABEL[b.status]}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <BookingSheet booking={open} onClose={() => setOpenId(null)} onChanged={load} />
    </section>
  );
}

function BookingSheet({ booking: b, onClose, onChanged }: { booking: Booking | null; onClose: () => void; onChanged: () => void }) {
  const { can } = useStaffAccess();
  const [license, setLicense] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [texts, setTexts] = useState<{ id: number; kind: string; to_number: string; status: string; error: string | null; created_at: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const loadTexts = useCallback(async () => {
    if (!b) return;
    const { data } = await getSupabase().from("rental_sms_log").select("id, kind, to_number, status, error, created_at").eq("booking_id", b.id).order("created_at");
    setTexts(data ?? []);
  }, [b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLicense(null);
    setProof(null);
    setError(null);
    setNote(null);
    setCancelling(false);
    if (!b) return;
    loadTexts();
    if (b.license_path)
      getSupabase()
        .storage.from("license-photos")
        .createSignedUrl(b.license_path, 600)
        .then(({ data }) => setLicense(data?.signedUrl ?? null));
    if (b.payment_proof_path)
      getSupabase()
        .storage.from("payment-proofs")
        .createSignedUrl(b.payment_proof_path, 600)
        .then(({ data }) => setProof(data?.signedUrl ?? null));
  }, [b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) return null;
  const sms = async (kind: string, resend = false) => {
    const res = await fetch("/api/rentals/sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_id: b.id, kind, resend }) });
    const j = await res.json().catch(() => ({}));
    setNote(res.ok ? (j.sent ? "Text sent to the customer." : j.skipped === "SMS turned off" ? "Texts are turned off in Settings." : null) : j.error ?? "The text couldn't be sent.");
    loadTexts();
  };
  const update = async (label: string, patch: Partial<Booking>) => {
    setBusy(label);
    setError(null);
    const { error } = await getSupabase().from("rental_bookings").update(patch).eq("id", b.id);
    if (error) setError(error.message);
    else if (patch.status === "cancelled") await sms("cancelled");
    else if (patch.status === "confirmed") await sms("confirmed");
    else if (patch.payment_status === "refunded") await sms("refunded");
    setBusy(null);
    onChanged();
  };
  const verifyGcash = () => update("Deposit verified", { status: "confirmed", payment_status: "deposit_paid" });
  const markRefunded = () => {
    if (!confirm(`Mark the ${formatPeso(b.pay_now ?? b.deposit_amount)} payment for ${b.booking_number} as sent back to the customer by GCash?`)) return;
    update("Mark deposit refunded", { payment_status: "refunded" });
  };
  const refund = async () => {
    if (!confirm(`Refund the ${formatPeso(b.pay_now ?? b.deposit_amount)} payment for ${b.booking_number} through HitPay?`)) return;
    setBusy("refund");
    setError(null);
    const res = await fetch("/api/rentals/refund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_id: b.id }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error ?? "Refund failed.");
    setBusy(null);
    onChanged();
    loadTexts();
  };
  const paid = ["deposit_paid", "paid"].includes(b.payment_status);
  const btn = (label: string, fn: () => void, cls = "btn-primary") => (
    <button className={`${cls} w-full`} onClick={fn} disabled={!!busy}>
      {busy === label ? <Spinner /> : label}
    </button>
  );
  return (
    <Sheet open onClose={onClose} title={b.booking_number} wide>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={b.status === "cancelled" ? "red" : b.status === "awaiting_deposit" ? "amber" : "green"}>{BOOKING_STATUS_LABEL[b.status]}</Badge>
          <Badge tone={paid ? "green" : b.payment_status === "refunded" ? "gray" : "amber"}>{PAYMENT_LABEL[b.payment_status] ?? b.payment_status}</Badge>
          {b.status === "cancelled" && paid && <Badge tone="red">Refund needed</Badge>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-lg font-bold">{b.customer_name}</p>
            <p>
              <a className="font-mono font-semibold underline" href={`tel:${b.customer_phone}`}>
                {b.customer_phone}
              </a>
              {b.customer_email && <> · {b.customer_email}</>}
            </p>
            <p>
              <strong>{b.scooter_name}</strong> · {b.helmets} helmet{b.helmets === 1 ? "" : "s"}
            </p>
            <p data-testid="booking-sheet-times">
              Pickup <strong>{prettyDateTime(b.pickup_at)}</strong>
              <br />
              Return by <strong>{prettyDateTime(b.return_at)}</strong> ({b.days} day{b.days === 1 ? "" : "s"})
              {b.status === "picked_up" && new Date(b.return_at).getTime() < Date.now() && <strong className="text-red-700"> · overdue</strong>}
            </p>
            <p>{b.delivery ? <>Deliver to: <strong>{b.delivery_address}</strong></> : "Customer picks up"}</p>
            {b.with_driver && (
              <p className="rounded-xl bg-sky-50 px-3 py-2 font-semibold text-sky-900" data-testid="booking-with-driver">
                🚗 With driver · {formatPeso(b.driver_fee ?? 0)} driver fee (no license needed)
              </p>
            )}
            {b.notes && <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">Note: {b.notes}</p>}
            <dl className="space-y-0.5 border-t border-coffee-100 pt-2">
              <div className="flex justify-between">
                <dt>
                  {b.days} day{b.days === 1 ? "" : "s"} × {formatPeso(b.daily_rate)}
                  {Number(b.excess_hours) > 0 ? ` + ${b.excess_hours} h × ${formatPeso(Number(b.excess_fee) / Number(b.excess_hours))}` : ""}
                  {b.delivery ? ` + delivery ${formatPeso(b.delivery_fee)}` : ""}
                </dt>
                <dd className="font-bold">{formatPeso(b.total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>
                  {b.security_upfront ? "Deposit + security deposit" : "Deposit"} ({b.payment_method === "gcash" ? "GCash" : "online"})
                </dt>
                <dd>{formatPeso(b.pay_now ?? b.deposit_amount)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Collect at pickup{Number(b.security_deposit) > 0 && !b.security_upfront ? " (incl. security deposit)" : ""}</dt>
                <dd data-testid="collect-at-pickup">
                  {formatPeso(
                    (b.payment_status === "paid" ? 0 : Number(b.total) - (paid || b.payment_status === "for_verification" ? Number(b.deposit_amount) : 0)) +
                      (b.security_upfront ? 0 : Number(b.security_deposit)),
                  )}
                </dd>
              </div>
              {Number(b.security_deposit) > 0 && (
                <div className="flex justify-between text-coffee-700">
                  <dt>Security deposit {b.security_upfront ? "(paid with the deposit — refund it after the rental)" : "(refundable)"}</dt>
                  <dd>{formatPeso(b.security_deposit)}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-coffee-600">
              Booked {formatDateTime(b.created_at)}
              {b.terms_agreed_at && ` · agreed to terms ${formatDateTime(b.terms_agreed_at)}`}
              {b.deposit_paid_at && ` · deposit ${b.payment_method === "gcash" ? "verified" : "paid"} ${formatDateTime(b.deposit_paid_at)}`}
              {b.picked_up_at && ` · picked up ${formatDateTime(b.picked_up_at)}`}
              {b.returned_at && ` · returned ${formatDateTime(b.returned_at)}`}
            </p>
            {b.cancel_reason && <p className="text-red-800">Cancelled: {b.cancel_reason}</p>}
          </div>
          <div>
            <p className="label">Driver&apos;s license</p>
            {!b.license_path ? (
              <p className="text-sm text-coffee-700">Not needed — booked with our driver.</p>
            ) : license ? (
              <a href={license} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={license} alt={`Driver's license of ${b.customer_name}`} className="w-full rounded-2xl border border-coffee-200 object-contain" data-testid="license-photo" />
              </a>
            ) : (
              <p className="text-sm text-coffee-600">Loading…</p>
            )}
            <p className="hint">Check the name matches and the license isn&apos;t expired at pickup.</p>
            {b.payment_method === "gcash" && (
              <div className="mt-4" data-testid="gcash-proof">
                <p className="label">GCash deposit</p>
                <p className="text-sm">
                  {b.gcash_reference && (
                    <>
                      Reference <strong className="font-mono">{b.gcash_reference}</strong> ·{" "}
                    </>
                  )}
                  Should be <strong>{formatPeso(b.pay_now ?? b.deposit_amount)}</strong>
                  {b.security_upfront ? " (deposit + security deposit)" : ""}
                </p>
                {proof ? (
                  <a href={proof} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proof} alt={`GCash receipt for ${b.booking_number}`} className="mt-1 max-h-96 w-full rounded-2xl border border-coffee-200 object-contain" data-testid="gcash-receipt" />
                  </a>
                ) : (
                  <p className="text-sm text-coffee-600">{b.payment_proof_path ? "Loading…" : "No screenshot."}</p>
                )}
                <p className="hint">Check the amount and the reference on the receipt against your GCash app before verifying.</p>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-3" data-testid="sms-log">
          <p className="mb-1 text-sm font-bold">Text messages</p>
          {texts.length === 0 ? (
            <p className="text-sm text-coffee-600">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {texts.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={t.status === "sent" ? "green" : t.status === "skipped" ? "gray" : "red"}>{t.status}</Badge>
                  <span className="font-semibold">{SMS_LABEL[t.kind] ?? t.kind}</span>
                  <span className="text-coffee-700">
                    to {t.to_number} · {formatDateTime(t.created_at)}
                  </span>
                  {t.error && <span className="w-full text-xs text-red-700">{t.error}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {["confirmed", "picked_up", "returned"].includes(b.status) && (
              <button className="btn-secondary btn-sm" onClick={() => sms("confirmed", true)}>
                Resend confirmation
              </button>
            )}
            {b.status === "cancelled" && (
              <button className="btn-secondary btn-sm" onClick={() => sms("cancelled", true)}>
                Resend cancellation
              </button>
            )}
          </div>
          {note && <p className="mt-1 text-sm text-coffee-700">{note}</p>}
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="space-y-2">
          {b.status === "awaiting_deposit" && b.payment_status === "for_verification" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {btn("Deposit verified", verifyGcash, "btn-sage")}
              <button className="btn-danger w-full" disabled={!!busy} onClick={() => update("Reject", { status: "cancelled", cancel_reason: "GCash payment not received" })}>
                {busy === "Reject" ? <Spinner /> : "Payment not received — cancel"}
              </button>
            </div>
          )}
          {b.status === "confirmed" && btn("Mark picked up", () => update("Mark picked up", { status: "picked_up" }))}
          {b.status === "picked_up" && btn("Mark returned", () => update("Mark returned", { status: "returned" }), "btn-sage")}
          {b.payment_status === "deposit_paid" && ["confirmed", "picked_up"].includes(b.status) && btn("Balance collected", () => update("Balance collected", { payment_status: "paid" }), "btn-secondary")}
          {b.status === "cancelled" &&
            paid &&
            (!can("refunds") ? (
              <p className="text-sm font-semibold text-red-800">Ask someone with the Refunds permission to refund the deposit.</p>
            ) : b.payment_method === "gcash" ? (
              <>
                <p className="text-sm text-coffee-700">
                  Send {formatPeso(b.pay_now ?? b.deposit_amount)} back to {b.customer_phone} by GCash, then mark it here.
                </p>
                {btn("Mark deposit refunded", markRefunded, "btn-danger")}
              </>
            ) : (
              btn(`Refund ${formatPeso(b.pay_now ?? b.deposit_amount)} payment`, refund, "btn-danger")
            ))}
          {["awaiting_deposit", "confirmed"].includes(b.status) &&
            (cancelling ? (
              <div className="space-y-2 rounded-2xl bg-cream p-3">
                <p className="font-semibold">Why are you cancelling?</p>
                <div className="flex flex-wrap gap-2">
                  {CANCEL_REASONS.map((r) => (
                    <button key={r} className={`rounded-full border px-3 py-1.5 text-sm ${reason === r ? "border-coffee-700 bg-coffee-50" : "border-coffee-200"}`} onClick={() => setReason(r)}>
                      {r}
                    </button>
                  ))}
                </div>
                <input className="input" aria-label="Cancel reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
                <div className="flex gap-2">
                  <button className="btn-danger flex-1" disabled={reason.trim().length < 3 || !!busy} onClick={() => update("Cancel booking", { status: "cancelled", cancel_reason: reason.trim() })}>
                    Cancel booking
                  </button>
                  <button className="btn-secondary" onClick={() => setCancelling(false)}>
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost w-full text-red-700" onClick={() => setCancelling(true)}>
                Cancel this booking…
              </button>
            ))}
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- calendar
function CalendarTab() {
  const { list, load } = useBookings();
  const today = manilaDate();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [day, setDay] = useState(today);
  const [openId, setOpenId] = useState<string | null>(null);
  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  if (!list) return <PageLoader />;
  const now = Date.now();
  const live = list.filter((b) => b.status !== "cancelled" && !(b.status === "awaiting_deposit" && b.payment_expires_at && new Date(b.payment_expires_at).getTime() < now));
  const range = (b: Booking) => ({ pickup_at: b.pickup_at, blocked_until: b.return_at });
  const on = (d: string) => live.filter((b) => touchesDay(range(b), d));
  const shift = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const dayList = on(day);
  const open = list.find((b) => b.id === openId) ?? null;
  const tone = (b: Booking) => (b.status === "awaiting_deposit" ? "bg-amber-200 text-amber-900" : b.status === "picked_up" ? "bg-sky-200 text-sky-900" : b.status === "returned" ? "bg-stone-200 text-stone-700" : "bg-sage-200 text-sage-800");
  return (
    <section className="space-y-3" data-testid="staff-calendar" data-month={`${ym.y}-${String(ym.m + 1).padStart(2, "0")}`}>
      <div className="card space-y-2 p-4">
        <div className="flex items-center justify-between">
          <button className="btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <p className="font-semibold">{monthLabel(ym.y, ym.m)}</p>
          <button className="btn-ghost btn-sm" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-coffee-600">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((d, i) => {
            if (!d) return <span key={i} />;
            const bs = on(d);
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                data-day={d}
                aria-label={`${d}: ${bs.length} booking${bs.length === 1 ? "" : "s"}`}
                className={`min-h-[4.5rem] rounded-lg border p-1 text-left align-top ${d === day ? "border-coffee-800 ring-1 ring-coffee-800" : "border-coffee-100"} ${d === today ? "bg-cream" : "bg-white"}`}
              >
                <span className="block text-xs font-bold">{Number(d.slice(8))}</span>
                {bs.slice(0, 3).map((b) => (
                  <span key={b.id} className={`mt-0.5 block truncate rounded px-1 text-[10px] font-semibold leading-4 ${tone(b)}`}>
                    {b.scooter_name}
                  </span>
                ))}
                {bs.length > 3 && <span className="block text-[10px] text-coffee-600">+{bs.length - 3} more</span>}
              </button>
            );
          })}
        </div>
        <p className="flex flex-wrap gap-3 text-xs text-coffee-700">
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-amber-200 align-middle" />GCash to check</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sage-200 align-middle" />confirmed</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sky-200 align-middle" />on the road</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-stone-200 align-middle" />returned</span>
        </p>
      </div>
      <div className="card space-y-2 p-4">
        <h2 className="font-semibold">
          {new Date(day + "T00:00:00").toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })}
          {day === today && " · today"}
        </h2>
        {dayList.length === 0 && <p className="text-sm text-coffee-700">No bookings on this day — every scooter is free.</p>}
        <ul className="grid gap-2">
          {dayList.map((b) => (
            <li key={b.id}>
              <button onClick={() => setOpenId(b.id)} className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-coffee-100 p-3 text-left" data-testid="calendar-booking">
                <span className="font-mono font-bold">{b.booking_number}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <strong>{b.scooter_name}</strong> · {b.customer_name}
                  <span className="block text-coffee-700">
                    {manilaDateOf(b.pickup_at) === day ? `Pickup ${prettyTime(b.pickup_at)}` : `since ${prettyDateTime(b.pickup_at)}`} ·{" "}
                    {manilaDateOf(b.return_at) === day ? `return ${prettyTime(b.return_at)}` : `until ${prettyDateTime(b.return_at)}`}
                  </span>
                </span>
                <Badge tone={b.status === "awaiting_deposit" ? "amber" : b.status === "picked_up" ? "blue" : "green"}>
                  {b.status === "awaiting_deposit" && b.payment_status === "for_verification" ? "GCash to check" : BOOKING_STATUS_LABEL[b.status]}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn-ghost btn-sm" onClick={() => setDay(addDays(day, 1))}>
          Next day →
        </button>
      </div>
      <BookingSheet booking={open} onClose={() => setOpenId(null)} onChanged={load} />
    </section>
  );
}

// ---------------------------------------------------------------- scooters
const EMPTY_SCOOTER = {
  name: "", description: "", daily_rate: "", security_deposit: "", units: "1", photo_url: null as string | null, is_active: true, sort_order: 0,
  vehicle_type: "scooter" as "scooter" | "car", seats: "", transmission: "" as "" | "automatic" | "manual", fuel: "" as "" | "gasoline" | "diesel" | "electric" | "hybrid", driver_fee: "",
};
function ScootersTab() {
  const [list, setList] = useState<Scooter[] | null>(null);
  const [edit, setEdit] = useState<(typeof EMPTY_SCOOTER & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from("scooters").select("*").order("sort_order").order("name");
    setList((data as Scooter[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const rate = Number(edit.daily_rate);
    if (edit.name.trim().length < 2) return setMsg({ tone: "red", text: "Enter the scooter's name." });
    if (!(rate > 0)) return setMsg({ tone: "red", text: "Enter the daily rate in pesos." });
    const sec = edit.security_deposit.trim() === "" ? null : Number(edit.security_deposit);
    if (sec !== null && !(sec >= 0)) return setMsg({ tone: "red", text: "Security deposit must be an amount in pesos (or empty to use the default)." });
    const units = Number(edit.units);
    if (!Number.isInteger(units) || units < 1 || units > 50) return setMsg({ tone: "red", text: "Number of units must be a whole number from 1 to 50." });
    setBusy(true);
    const isCar = edit.vehicle_type === "car";
    const seats = isCar && edit.seats.trim() ? Number(edit.seats) : null;
    if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 30)) return setMsg({ tone: "red", text: "Seats must be a whole number from 1 to 30." });
    const driverFee = isCar && edit.driver_fee.trim() ? Number(edit.driver_fee) : null;
    if (driverFee !== null && (!Number.isFinite(driverFee) || driverFee < 0)) return setMsg({ tone: "red", text: "Driver fee must be 0 or more (empty = self-drive only)." });
    const row = {
      name: edit.name.trim(), description: edit.description.trim() || null, daily_rate: rate, security_deposit: sec, units, photo_url: edit.photo_url, is_active: edit.is_active, sort_order: Number(edit.sort_order) || 0,
      vehicle_type: edit.vehicle_type, seats, transmission: isCar ? edit.transmission || null : null, fuel: isCar ? edit.fuel || null : null, driver_fee: driverFee,
    };
    const { error } = edit.id ? await getSupabase().from("scooters").update(row).eq("id", edit.id) : await getSupabase().from("scooters").insert(row);
    setBusy(false);
    if (error) return setMsg({ tone: "red", text: error.message });
    setMsg({ tone: "green", text: `${row.name} saved.` });
    setEdit(null);
    load();
  };
  const photo = async (f: File | undefined) => {
    if (!f || !edit) return;
    setBusy(true);
    try {
      const url = await uploadPublicImage(f, "scooters", { maxDim: 1200 });
      setEdit({ ...edit, photo_url: url });
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    }
    setBusy(false);
  };

  if (!list) return <PageLoader />;
  return (
    <section className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <button className="btn-primary" onClick={() => setEdit({ ...EMPTY_SCOOTER, sort_order: list.length })}>
        + Add vehicle
      </button>
      {list.length === 0 && <p className="card p-6 text-center text-coffee-700">No scooters yet. Add your first one — customers can only book scooters listed here.</p>}
      <ul className="grid gap-2">
        {list.map((s) => (
          <li key={s.id} className="card flex items-center gap-3 p-3" data-testid="scooter-row">
            <ScooterPhoto car={s.vehicle_type === "car"} src={s.photo_url} alt={s.name} className="h-16 w-16 shrink-0 rounded-xl" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">
                {s.vehicle_type === "car" ? "🚗 " : "🛵 "}
                {s.name}
              </span>
              <span className="block text-sm text-coffee-700">
                {s.vehicle_type === "car" && carSpecs(s) ? `${carSpecs(s)} · ` : ""}
                {s.vehicle_type === "car" ? (s.driver_fee != null ? `driver +${formatPeso(s.driver_fee)}/day · ` : "self-drive only · ") : ""}
                {formatPeso(s.daily_rate)}/day · {s.units} unit{s.units === 1 ? "" : "s"}
                {s.security_deposit != null ? ` · ${formatPeso(s.security_deposit)} security deposit` : ""}
                {s.description ? ` · ${s.description}` : ""}
              </span>
            </span>
            {!s.is_active && <Badge tone="gray">Hidden</Badge>}
            <button className="btn-secondary btn-sm" onClick={() =>
                setEdit({
                  id: s.id, name: s.name, description: s.description ?? "", daily_rate: String(s.daily_rate), security_deposit: s.security_deposit == null ? "" : String(s.security_deposit), units: String(s.units ?? 1), photo_url: s.photo_url, is_active: s.is_active, sort_order: s.sort_order,
                  vehicle_type: s.vehicle_type ?? "scooter", seats: s.seats == null ? "" : String(s.seats), transmission: s.transmission ?? "", fuel: s.fuel ?? "", driver_fee: s.driver_fee == null ? "" : String(s.driver_fee),
                })
              }>
              Edit
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.vehicle_type === "car" ? "car" : "scooter"}` : "Add vehicle"}>
        {edit && (
          <form onSubmit={save} className="space-y-3 p-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-coffee-100 p-1" role="radiogroup" aria-label="Vehicle type">
              {(["scooter", "car"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={edit.vehicle_type === v} onClick={() => setEdit({ ...edit, vehicle_type: v })} className={`min-h-[44px] rounded-xl font-semibold ${edit.vehicle_type === v ? "bg-white shadow" : "text-coffee-700"}`}>
                  {v === "car" ? "🚗 Car" : "🛵 Scooter"}
                </button>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="scooter-name">
                Name
              </label>
              <input id="scooter-name" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} placeholder="Honda Click 125" />
            </div>
            <div>
              <label className="label" htmlFor="scooter-desc">
                Short description <span className="font-normal text-coffee-600">(optional)</span>
              </label>
              <input id="scooter-desc" className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={120} placeholder="Automatic · good for 2 · with top box" />
            </div>
            <div>
              <label className="label" htmlFor="scooter-rate">
                Daily rate (₱)
              </label>
              <input id="scooter-rate" className="input" inputMode="decimal" value={edit.daily_rate} onChange={(e) => setEdit({ ...edit, daily_rate: e.target.value })} placeholder="500" />
            </div>
            <div>
              <label className="label" htmlFor="scooter-security">
                Security deposit (₱)
              </label>
              <input id="scooter-security" className="input" inputMode="decimal" value={edit.security_deposit} onChange={(e) => setEdit({ ...edit, security_deposit: e.target.value })} placeholder="Default from Settings" />
              <p className="hint">Refundable deposit for this scooter. Empty = use the default from Rentals → Settings; 0 = none.</p>
            </div>
            <div>
              <label className="label" htmlFor="scooter-units">
                Number of units
              </label>
              <input id="scooter-units" className="input" inputMode="numeric" value={edit.units} onChange={(e) => setEdit({ ...edit, units: e.target.value })} placeholder="1" />
              <p className="hint">How many of this scooter you have. That many customers can book it for the same dates; it shows as Booked only when all are taken.</p>
            </div>
            {edit.vehicle_type === "car" && (
              <div className="grid gap-3 rounded-2xl border border-coffee-100 p-3 sm:grid-cols-2" data-testid="car-fields">
                <div>
                  <label className="label" htmlFor="car-seats">
                    Seats
                  </label>
                  <input id="car-seats" className="input" inputMode="numeric" value={edit.seats} onChange={(e) => setEdit({ ...edit, seats: e.target.value })} placeholder="5" />
                </div>
                <div>
                  <label className="label" htmlFor="car-transmission">
                    Transmission
                  </label>
                  <select id="car-transmission" className="input" value={edit.transmission} onChange={(e) => setEdit({ ...edit, transmission: e.target.value as typeof edit.transmission })}>
                    <option value="">—</option>
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="car-fuel">
                    Fuel
                  </label>
                  <select id="car-fuel" className="input" value={edit.fuel} onChange={(e) => setEdit({ ...edit, fuel: e.target.value as typeof edit.fuel })}>
                    <option value="">—</option>
                    <option value="gasoline">Gasoline</option>
                    <option value="diesel">Diesel</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="electric">Electric</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="car-driver-fee">
                    Driver fee per day (₱)
                  </label>
                  <input id="car-driver-fee" className="input" inputMode="decimal" value={edit.driver_fee} onChange={(e) => setEdit({ ...edit, driver_fee: e.target.value })} placeholder="Empty = self-drive only" />
                </div>
                <p className="hint sm:col-span-2">With a driver fee, customers can book &ldquo;with a driver&rdquo; (no license needed); the fee is added per day.</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <ScooterPhoto car={edit.vehicle_type === "car"} src={edit.photo_url} alt="" className="h-20 w-20 rounded-xl" />
              <label className="btn-secondary btn-sm cursor-pointer">
                {busy ? <Spinner /> : edit.photo_url ? "Change photo" : "Add photo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Scooter photo" onChange={(e) => photo(e.target.files?.[0])} />
              </label>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="font-semibold">Show on the booking page</span>
              <Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Show on the booking page" />
            </label>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner /> : edit.vehicle_type === "car" ? "Save car" : "Save scooter"}
            </button>
            <p className="hint">Price changes apply to new bookings only. To stop renting a scooter, hide it instead of deleting (past bookings keep it).</p>
          </form>
        )}
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------- settings
function SettingsTab() {
  const [s, setS] = useState<RentalSettings | null>(null);
  const [gcash, setGcash] = useState<{ number: string | null; qr: string | null } | null>(null);
  const [hitpay, setHitpay] = useState<{ configured: boolean; testMode: boolean } | null>(null);
  const [smsStatus, setSmsStatus] = useState<{ configured: boolean; sender: string | null } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [scooterCount, setScooterCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  useEffect(() => {
    const db = getSupabase();
    db.from("rental_settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as RentalSettings));
    db.from("scooters").select("id", { count: "exact", head: true }).eq("is_active", true).then(({ count }) => setScooterCount(count ?? 0));
    fetch("/api/rentals/sms")
      .then((r) => r.json())
      .then(setSmsStatus)
      .catch(() => setSmsStatus({ configured: false, sender: null }));
    fetch("/api/payments/status")
      .then((r) => r.json())
      .then(setHitpay)
      .catch(() => setHitpay({ configured: false, testMode: false }));
    db.from("store_settings").select("gcash_number, gcash_qr_url").eq("id", 1).single().then(({ data }) => setGcash({ number: data?.gcash_number ?? null, qr: data?.gcash_qr_url ?? null }));
  }, []);
  if (!s) return <PageLoader />;
  const set = <K extends keyof RentalSettings>(k: K, v: RentalSettings[K]) => setS({ ...s, [k]: v });
  const ready = !!s.terms?.trim();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (hhmm(s.open_time, "08:00") >= hhmm(s.close_time, "22:00")) return setMsg({ tone: "red", text: "The latest pickup/return time must be after the earliest." });
    const mu = s.messenger_url?.trim();
    if (mu && !/^https:\/\/\S+$/.test(mu)) return setMsg({ tone: "red", text: "The Messenger link must start with https:// (for example https://m.me/YourPage)." });
    setBusy(true);
    const { error } = await getSupabase()
      .from("rental_settings")
      .update({
        bookings_enabled: s.bookings_enabled && ready,
        terms: s.terms?.trim() || null,
        open_time: hhmm(s.open_time, "08:00"),
        close_time: hhmm(s.close_time, "22:00"),
        messenger_url: s.messenger_url?.trim() || null,
        online_enabled: !!s.online_enabled && !!hitpay?.configured,
        deposit_percent: Math.min(100, Math.max(10, Number(s.deposit_percent) || 30)),
        security_deposit: Math.max(0, Number(s.security_deposit) || 0),
        security_deposit_note: s.security_deposit_note?.trim() || null,
        pickup_note: s.pickup_note?.trim() || null,
        max_days: Math.min(90, Math.max(1, Number(s.max_days) || 30)),
        excess_hour_rate: Math.max(0, Number(s.excess_hour_rate) || 0),
        max_excess_hours: Math.min(23, Math.max(0, Math.round(Number(s.max_excess_hours) || 0))),
        turnaround_minutes: Math.min(240, Math.max(0, Number(s.turnaround_minutes) || 0)),
        sms_enabled: !!s.sms_enabled,
        staff_alert_phones: s.staff_alert_phones?.trim() || null,
        reminder_hours: Math.min(24, Math.max(1, Number(s.reminder_hours) || 3)),
      })
      .eq("id", 1);
    setBusy(false);
    setMsg(error ? { tone: "red", text: error.message } : { tone: "green", text: "Rental settings saved." });
  };
  const num = (k: keyof RentalSettings) => ({ value: String(s[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never) });
  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-bold">Accept bookings</span>
          <span className="text-sm text-coffee-700">Off = the Baybayin page shows &ldquo;Coming soon&rdquo;. On = customers can book and send the deposit by GCash.</span>
        </span>
        <Toggle checked={s.bookings_enabled && ready} onChange={(v) => set("bookings_enabled", v)} disabled={!ready} label="Accept bookings" />
      </label>
      {!ready && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="terms-needed">Write your terms and conditions below and save — bookings can&apos;t open without them.</p>}
      {s.bookings_enabled && !s.terms?.trim() && <p className="text-sm text-amber-900">Bookings are switched on but stay closed (&ldquo;Coming soon&rdquo;) until terms are saved.</p>}
      <label className="flex items-center justify-between gap-3" data-testid="rental-online-setting">
        <span>
          <span className="block font-bold">Online deposit (HitPay)</span>
          <span className="text-sm text-coffee-700">On = customers can also pay the deposit online (GCash, Maya, QR Ph, online banking) and the booking confirms automatically. GCash with a receipt stays available.</span>
        </span>
        <Toggle checked={!!s.online_enabled && !!hitpay?.configured} onChange={(v) => set("online_enabled", v)} disabled={!hitpay?.configured} label="Online deposit (HitPay)" />
      </label>
      {hitpay && !hitpay.configured && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">HitPay isn&apos;t set up on the website, so online deposits can&apos;t be switched on. See docs/PAYMENTS.md.</p>}
      {hitpay?.configured && hitpay.testMode && <p className="rounded-2xl bg-sky-100 px-4 py-3 text-sm text-sky-900"><strong>Test mode:</strong> HitPay sandbox is active — deposits aren&apos;t real money.</p>}
      {gcash && (
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-coffee-800 ring-1 ring-coffee-100">
          GCash deposits are paid to the café&apos;s GCash from <strong>Settings → Payments</strong>
          {gcash.number ? ` (${gcash.number})` : ""}.{!gcash.qr && !gcash.number && <strong className="text-red-700"> No GCash number or QR is set there yet.</strong>}
        </p>
      )}
      {s.bookings_enabled && scooterCount === 0 && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No scooters are shown yet — add at least one in the Scooters tab.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="deposit-percent">
            GCash deposit (%)
          </label>
          <input id="deposit-percent" className="input" inputMode="numeric" {...num("deposit_percent")} />
          <p className="hint">10–100% of the rental, sent by GCash when booking.</p>
        </div>
        <div>
          <label className="label" htmlFor="max-days">
            Longest rental (days)
          </label>
          <input id="max-days" className="input" inputMode="numeric" {...num("max_days")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="excess-rate">
            Extra hour rate (₱/hour)
          </label>
          <input id="excess-rate" className="input" inputMode="decimal" {...num("excess_hour_rate")} />
          <p className="hint">Charged per 24 hours; each hour past the last full day costs this much.</p>
        </div>
        <div>
          <label className="label" htmlFor="max-excess">
            Most extra hours charged by the hour
          </label>
          <input id="max-excess" className="input" inputMode="numeric" {...num("max_excess_hours")} />
          <p className="hint">More extra hours than this count as one more day. 0–23 (default 6).</p>
        </div>
        <div>
          <label className="label" htmlFor="turnaround-minutes">
            Time between bookings (minutes)
          </label>
          <input id="turnaround-minutes" className="input" inputMode="numeric" {...num("turnaround_minutes")} />
          <p className="hint">Gap after each return before the same scooter can be picked up again (handover, checking, fuel). 0–240.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="security-deposit">
            Default security deposit (₱)
          </label>
          <input id="security-deposit" className="input" inputMode="decimal" {...num("security_deposit")} />
          <p className="hint">For scooters without their own amount (set per scooter in the Scooters tab). Customers pay it at pickup or together with the deposit; returned after. 0 = none.</p>
        </div>
        <div>
          <label className="label" htmlFor="security-note">
            Security deposit note <span className="font-normal text-coffee-600">(optional)</span>
          </label>
          <input id="security-note" className="input" value={s.security_deposit_note ?? ""} onChange={(e) => set("security_deposit_note", e.target.value)} maxLength={120} placeholder="or leave a valid ID" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="rental-terms">
          Terms and conditions
        </label>
        <textarea id="rental-terms" className="input min-h-[12rem] font-normal leading-relaxed" value={s.terms ?? ""} onChange={(e) => set("terms", e.target.value)} maxLength={20000} placeholder="Paste your rental terms here…" />
        <p className="hint">
          Customers must tick &ldquo;I agree&rdquo; before the GCash payment form appears. Each booking keeps a copy of the terms it was made under
          {s.terms_updated_at ? ` · last changed ${formatDateTime(s.terms_updated_at)}` : ""}.
        </p>
      </div>
      <fieldset className="space-y-3 rounded-2xl border border-coffee-100 p-4" data-testid="rental-hours-settings">
        <legend className="px-1 font-bold">Pickup &amp; return hours</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["open_time", "rental-open", "Earliest time", "08:00"],
              ["close_time", "rental-close", "Latest time", "22:00"],
            ] as const
          ).map(([k, id, label, def]) => (
            <div key={k}>
              <label className="label" htmlFor={id}>
                {label}
              </label>
              <select id={id} className="input" value={hhmm(s[k], def)} onChange={(e) => set(k, e.target.value)}>
                {TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>
                    {slotLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="hint">Customers can only choose pickup and return times in this range. Outside it, they tick &ldquo;I need a pickup or return outside these hours&rdquo; and message you instead.</p>
        <div>
          <label className="label" htmlFor="messenger-url">
            Messenger link for special arrangements
          </label>
          <input id="messenger-url" className="input" inputMode="url" value={s.messenger_url ?? ""} onChange={(e) => set("messenger_url", e.target.value)} placeholder="https://m.me/YourBaybayinPage" />
          <p className="hint">Your Facebook page&apos;s Messenger link (m.me/ + the page&apos;s username). Empty = customers are asked to message the Facebook page; the café phone from Settings is shown too.</p>
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="pickup-note">
          Pickup instructions
        </label>
        <input id="pickup-note" className="input" value={s.pickup_note ?? ""} onChange={(e) => set("pickup_note", e.target.value)} maxLength={200} placeholder="At Pahuway Cafe, Poblacion — 8 AM to 6 PM" />
      </div>
      <div className="space-y-3 border-t border-coffee-100 pt-4" data-testid="sms-settings">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-bold">Text messages (SMS)</span>
            <span className="text-sm text-coffee-700">Booking confirmed (after you verify the GCash deposit), pickup reminder, cancelled and deposit refunded — to the customer; plus a new-booking alert to staff. Sent through Semaphore.</span>
          </span>
          <Toggle checked={!!s.sms_enabled} onChange={(v) => set("sms_enabled", v)} label="Send text messages" />
        </label>
        {smsStatus && !smsStatus.configured && (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Not set up yet: add your Semaphore API key to the website&apos;s server settings (SEMAPHORE_API_KEY on Vercel, see docs/RENTALS.md). Until then no texts are sent; bookings still work.</p>
        )}
        {smsStatus?.configured && <p className="text-sm text-sage-700">Semaphore is connected{smsStatus.sender ? ` · sender name ${smsStatus.sender}` : " · default sender name"}.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="staff-alert-phones">
              Staff alert number(s)
            </label>
            <input id="staff-alert-phones" className="input" value={s.staff_alert_phones ?? ""} onChange={(e) => set("staff_alert_phones", e.target.value)} placeholder="09171234567, 09181234567" />
            <p className="hint">Texted when a booking is confirmed. Empty = no staff alert.</p>
          </div>
          <div>
            <label className="label" htmlFor="reminder-hours">
              Pickup reminder (hours before)
            </label>
            <input id="reminder-hours" className="input" inputMode="numeric" {...num("reminder_hours")} />
            <p className="hint">1–24. Not sent for bookings made less than 30 minutes before.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="test-phone">
              Send a test text to
            </label>
            <input id="test-phone" className="input" inputMode="numeric" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="09XXXXXXXXX" />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              setTestMsg(null);
              const res = await fetch("/api/rentals/sms-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: testPhone }) });
              const j = await res.json().catch(() => ({}));
              setTestMsg(res.ok ? { tone: "green", text: `Test text sent to ${testPhone}. It should arrive within a minute.` } : { tone: "red", text: j.error ?? "Couldn't send the test text." });
            }}
          >
            Send test text
          </button>
        </div>
        {testMsg && <Alert tone={testMsg.tone}>{testMsg.text}</Alert>}
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : "Save rental settings"}
      </button>
    </form>
  );
}
