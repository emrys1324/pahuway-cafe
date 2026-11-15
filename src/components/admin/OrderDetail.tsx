"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Sheet, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso, ORDER_TYPE_LABEL, PAYMENT_STATUS_LABEL, STATUS_LABEL } from "@/lib/format";
import { formatDateTime, formatTime } from "@/lib/hours";
import type { Order, OrderStatus, Rider } from "@/lib/types";
import { useStaffAccess } from "./StaffAccess";
import { MapView } from "@/components/map/MapView";
import { googleMapsPin, toLatLng } from "@/lib/maps";

const REJECT_REASONS = ["Item not available", "Outside our delivery area", "GCash payment not received", "We're about to close", "Couldn't reach customer"];

export function OrderDetail({ order, riders, onClose, store }: { order: Order | null; riders: Rider[]; onClose: () => void; store?: string | null }) {
  const { can } = useStaffAccess();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    setError(null);
    setRejecting(false);
    setReason("");
    setProofUrl(null);
    if (order?.payment_proof_path) {
      getSupabase()
        .storage.from("payment-proofs")
        .createSignedUrl(order.payment_proof_path, 600)
        .then(({ data }) => setProofUrl(data?.signedUrl ?? null));
    }
  }, [order?.id, order?.payment_proof_path]);

  if (!order) return null;
  const o = order;

  const update = async (label: string, patch: Partial<Order>) => {
    setBusy(label);
    setError(null);
    const { error } = await getSupabase().from("orders").update(patch).eq("id", o.id);
    setBusy(null);
    if (error) setError(error.message);
    return !error;
  };
  const setStatus = (s: OrderStatus, extra: Partial<Order> = {}) => update(s, { status: s, ...extra });

  const refundLabel = `Refund ${formatPeso(o.total)} to customer`;
  const refund = async () => {
    if (!confirm(`Refund ${formatPeso(o.total)} for ${o.order_number} through HitPay?`)) return;
    setBusy(refundLabel);
    setError(null);
    const res = await fetch("/api/payments/refund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: o.id }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setError(json.error ?? "Refund failed.");
  };
  const paidOnline = o.payment_method === "online" && o.payment_status === "paid";

  const needsVerify = o.payment_method === "gcash" && o.payment_status !== "paid";
  const active = !["completed", "cancelled"].includes(o.status);
  const pin = toLatLng(o.delivery_lat, o.delivery_lng);
  const btn = (label: string, onClick: () => void, cls = "btn-primary", disabled = false) => (
    <button className={`${cls} w-full`} onClick={onClick} disabled={!!busy || disabled}>
      {busy === label ? <Spinner /> : label}
    </button>
  );

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {o.order_number}
          {store && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-800">{store}</span>}
          <Badge tone={o.status === "cancelled" ? "red" : o.status === "completed" ? "green" : "amber"}>{STATUS_LABEL[o.status]}</Badge>
        </span>
      }
      footer={
        active && (
          <div className="space-y-2">
            {error && <Alert>{error}</Alert>}
            {rejecting ? (
              <div className="space-y-2">
                <p className="font-semibold">Why are you {o.status === "received" ? "rejecting" : "cancelling"} this order? The customer will see this.</p>
                <div className="flex flex-wrap gap-2">
                  {REJECT_REASONS.map((r) => (
                    <button key={r} type="button" onClick={() => setReason(r)} className={`chip ${reason === r ? "border-red-700 bg-red-700 text-white" : "border-coffee-200 bg-white"}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <input className="input" placeholder="Or type a reason…" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} aria-label="Reason" />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary" onClick={() => setRejecting(false)}>
                    Back
                  </button>
                  {btn("Confirm", async () => {
                    if ((await setStatus("cancelled", { cancel_reason: reason.trim() })) && !paidOnline) onClose();
                  }, "btn-danger", reason.trim().length < 3)}
                </div>
              </div>
            ) : (
              <>
                {o.status === "received" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn-secondary w-full text-red-700" onClick={() => setRejecting(true)} disabled={!!busy}>
                      Reject
                    </button>
                    {btn("Accept & prepare", () => setStatus("preparing"), "btn-sage")}
                  </div>
                )}
                {o.status === "preparing" && btn("Mark ready", () => setStatus("ready"), "btn-sage")}
                {o.status === "ready" && o.order_type !== "delivery" && btn("Complete — customer has it", () => setStatus("completed"), "btn-sage")}
                {o.status === "ready" && o.order_type === "delivery" && btn("Handed to rider — out for delivery", () => setStatus("out_for_delivery"), "btn-sage", !o.rider_id)}
                {o.status === "out_for_delivery" && btn("Mark delivered", () => setStatus("completed"), "btn-sage")}
                {o.status !== "received" && (
                  <button className="btn-ghost btn-sm w-full text-red-700" onClick={() => setRejecting(true)} disabled={!!busy}>
                    Cancel order
                  </button>
                )}
              </>
            )}
          </div>
        )
      }
    >
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-4">
            <p className="text-sm text-coffee-600">Customer</p>
            <p className="text-lg font-bold">{o.customer_name}</p>
            <a href={`tel:${o.customer_phone}`} className="font-mono text-lg font-semibold text-coffee-700 underline">
              {o.customer_phone}
            </a>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <p className="text-sm text-coffee-600">{ORDER_TYPE_LABEL[o.order_type]}</p>
            <p className="text-lg font-bold">{o.scheduled_for ? `Scheduled ${formatTime(o.scheduled_for)}` : "ASAP"}</p>
            <p className="text-sm text-coffee-700">Placed {formatDateTime(o.created_at)}</p>
          </div>
        </div>

        {o.order_type === "delivery" && (
          <div className="space-y-3 rounded-2xl bg-white p-4">
            <div>
              <p className="text-sm text-coffee-600">Deliver to · {o.zone_name}</p>
              <p className="font-semibold">{o.street}</p>
              {o.landmark && <p className="text-coffee-700">Landmark: {o.landmark}</p>}
              {o.rider_notes && <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Note to rider: {o.rider_notes}</p>}
              {pin ? (
                <div className="mt-2 space-y-1">
                  <MapView key={o.id} value={pin} className="h-36 w-full" label="Customer's pinned location" />
                  <a className="text-sm font-semibold text-coffee-700 underline" href={googleMapsPin(pin)} target="_blank" rel="noreferrer" data-testid="staff-pin-link">
                    📍 Pinned location — open in Google Maps
                  </a>
                </div>
              ) : (
                <p className="mt-1 text-xs text-coffee-600">No map pin.</p>
              )}
            </div>
            {active && (
              <div>
                <label className="label" htmlFor="rider">
                  Rider
                </label>
                <select
                  id="rider"
                  className="input"
                  value={o.rider_id ?? ""}
                  disabled={!!busy}
                  onChange={(e) => update("rider", { rider_id: e.target.value || null })}
                >
                  <option value="">— Assign a rider —</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {riders.length === 0 && <p className="hint">No riders yet. An admin can invite one in Settings → Team.</p>}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-white p-4">
          <ul className="divide-y divide-coffee-100">
            {(o.order_items ?? []).map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2.5">
                <div>
                  <p className="text-lg font-bold">
                    {i.quantity}× {i.item_name}
                  </p>
                  {i.options.length > 0 && <p className="text-coffee-700">{i.options.map((x) => x.name).join(" · ")}</p>}
                  {i.notes && <p className="mt-0.5 rounded-lg bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-900">Note: {i.notes}</p>}
                </div>
                <span className="tabular-nums">{formatPeso(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-coffee-100 pt-2 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatPeso(o.subtotal)}</dd>
            </div>
            {o.delivery_fee > 0 && (
              <div className="flex justify-between">
                <dt>Delivery</dt>
                <dd>{formatPeso(o.delivery_fee)}</dd>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold">
              <dt>Total</dt>
              <dd>{formatPeso(o.total)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="font-bold">{o.payment_method === "gcash" ? "GCash (manual)" : o.payment_method === "online" ? "Online · HitPay" : "Cash"}</p>
            <Badge tone={o.payment_status === "paid" ? "green" : o.payment_status === "for_verification" ? "red" : "gray"}>{PAYMENT_STATUS_LABEL[o.payment_status]}</Badge>
          </div>
          {o.payment_method === "gcash" && (
            <div className="mt-3 space-y-3">
              {o.gcash_reference ? (
                <p>
                  Reference no.: <span className="font-mono text-lg font-bold">{o.gcash_reference}</span>
                </p>
              ) : (
                <p className="text-sm text-coffee-700">Check the amount and reference on the screenshot against your GCash app.</p>
              )}
              {proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proofUrl} alt="GCash payment screenshot" className="max-h-80 rounded-xl border border-coffee-100" />
                  <span className="text-sm text-coffee-600 underline">Open full size</span>
                </a>
              ) : (
                o.payment_proof_path && <p className="text-sm text-coffee-600">Loading screenshot…</p>
              )}
              {needsVerify && (
                <>
                  <p className="text-sm text-coffee-700">
                    Check that {formatPeso(o.total)} with this reference number arrived in the café GCash app, then verify.
                  </p>
                  {btn("Mark GCash payment verified", () => update("verify", { payment_status: "paid" }), "btn-sage")}
                </>
              )}
            </div>
          )}
          {o.payment_method === "online" && (
            <div className="mt-3 space-y-2 text-sm">
              {o.paid_at && <p className="text-coffee-700">Paid {formatDateTime(o.paid_at)} via GCash / QR Ph — no need to collect cash.</p>}
              {o.gateway_payment_id && (
                <p className="text-coffee-600">
                  HitPay ref: <span className="font-mono">{o.gateway_payment_id}</span>
                </p>
              )}
              {o.payment_status === "refunded" && (
                <p className="font-semibold text-coffee-700">
                  Refunded{o.refunded_at ? ` ${formatDateTime(o.refunded_at)}` : ""}. The customer gets the money back in their GCash/bank account (timing depends on the method).
                </p>
              )}
              {o.payment_status === "paid" && o.status === "cancelled" && (
                <>
                  <Alert tone="amber">This order is cancelled but was paid online. Refund the customer:</Alert>
                  {can("refunds") ? btn(`Refund ${formatPeso(o.total)} to customer`, refund, "btn-danger") : <p className="text-sm font-semibold text-red-800">Ask someone who can do refunds to refund this order.</p>}
                </>
              )}
              {o.payment_status === "paid" && o.status !== "cancelled" && <p className="text-coffee-600">To refund, cancel the order first.</p>}
            </div>
          )}
          {o.payment_method === "cash" && o.order_type === "delivery" && o.payment_status !== "paid" && (
            <p className="mt-1 text-sm text-coffee-700">Rider collects {formatPeso(o.total)}.</p>
          )}
        </div>

        {o.status === "received" && needsVerify && <Alert tone="amber">GCash payment isn&apos;t verified yet. You can still accept and verify later.</Alert>}
        {o.cancel_reason && <Alert>Cancelled: {o.cancel_reason}</Alert>}
        {!active && error && <Alert>{error}</Alert>}
      </div>
    </Sheet>
  );
}
