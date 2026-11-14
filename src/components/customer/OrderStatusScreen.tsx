"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Logo, useCustomerHeaderStyle } from "./Header";
import { GcashFallback } from "./GcashFallback";
import { OrderChat } from "@/components/OrderChat";
import { Alert, Badge, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { enableOrderPush, isNativeApp, pushAvailable, type PushResult } from "@/lib/native";
import { formatPeso, ORDER_TYPE_LABEL } from "@/lib/format";
import { formatDateTime, formatTime } from "@/lib/hours";
import type { OrderStatus, OrderType, PaymentMethod, PaymentStatus } from "@/lib/types";

interface PublicOrder {
  order_number: string;
  status: OrderStatus;
  order_type: OrderType;
  customer_name: string;
  scheduled_for: string | null;
  zone_name: string | null;
  street: string | null;
  landmark: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  checkout_url: string | null;
  payment_expires_at: string | null;
  paid_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
  rider_name: string | null;
  items: { item_name: string; quantity: number; options: { name: string }[]; notes: string | null; line_total: number }[];
}

function steps(type: OrderType): { status: OrderStatus; label: string; detail: string; at: keyof PublicOrder }[] {
  const base = [
    { status: "received" as const, label: "Order received", detail: "We got your order.", at: "created_at" as const },
    { status: "preparing" as const, label: "Preparing", detail: "Our baristas are on it.", at: "accepted_at" as const },
  ];
  if (type === "delivery")
    return [
      ...base,
      { status: "ready", label: "Packed", detail: "Waiting for our rider.", at: "ready_at" },
      { status: "out_for_delivery", label: "Out for delivery", detail: "Your order is on the way!", at: "picked_up_at" },
      { status: "completed", label: "Delivered", detail: "Enjoy! Salamat po.", at: "completed_at" },
    ];
  return [
    ...base,
    { status: "ready", label: type === "pickup" ? "Ready for pickup" : "Ready", detail: type === "pickup" ? "Come grab it at the counter." : "See you at the café!", at: "ready_at" },
    { status: "completed", label: "Completed", detail: "Enjoy! Salamat po.", at: "completed_at" },
  ];
}

export function OrderStatusScreen({ token }: { token: string }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Inner token={token} />
    </Suspense>
  );
}

function Inner({ token }: { token: string }) {
  const params = useSearchParams();
  const isNew = params.get("new") === "1";
  const returnedFromPayment = params.get("paid") === "1";
  const hs = useCustomerHeaderStyle();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);
  const [push, setPush] = useState<PushResult | "asking" | null>(null);
  // chat with the rider: only the signed-in owner of a delivery order can see the order id (row-level security)
  const [chat, setChat] = useState<{ id: string; riderAssigned: boolean } | null>(null);
  useEffect(() => {
    if (!order || order.order_type !== "delivery") return;
    getSupabase()
      .from("orders")
      .select("id, rider_id")
      .eq("public_token", token)
      .maybeSingle()
      .then(({ data }) => setChat(data ? { id: data.id, riderAssigned: !!data.rider_id } : null));
  }, [token, order?.order_type, order?.status, order?.rider_name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isNativeApp()) return;
    pushAvailable().then((ok) => {
      if (!ok) return setPush("unavailable");
      setNative(true);
      try {
        if (localStorage.getItem(`isla-push-order-${token}`)) setPush("enabled");
      } catch {}
    });
  }, [token]);
  const askPush = async () => {
    setPush("asking");
    const r = await enableOrderPush(token);
    setPush(r);
    if (r === "enabled") {
      try {
        localStorage.setItem(`isla-push-order-${token}`, "1");
      } catch {}
    }
  };

  const load = useCallback(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return setNotFound(true);
    const { data, error } = await getSupabase().rpc("get_order_by_token", { p_token: token });
    if (error) return;
    if (!data) setNotFound(true);
    else setOrder(data as PublicOrder);
  }, [token]);

  useEffect(() => {
    load();
    const supabase = getSupabase();
    const ch = supabase
      .channel(`order-${token}`)
      .on("broadcast", { event: "status" }, () => load())
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(load, 20_000); // safety net if the live connection drops
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
    };
  }, [token, load]);

  const share = async () => {
    const url = window.location.origin + `/order/${token}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Pahuway Cafe order ${order?.order_number}`, url });
        return;
      } catch {}
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (notFound)
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Logo />
        <h1 className="mt-8 font-display text-2xl font-bold">Order not found</h1>
        <p className="mt-2 text-coffee-700">Please check the link, or call the café.</p>
        <Link href="/menu" className="btn-primary mt-6">
          Back to menu
        </Link>
      </div>
    );
  if (!order) return <PageLoader />;

  const flow = steps(order.order_type);
  const currentIdx = flow.findIndex((s) => s.status === order.status);
  const cancelled = order.status === "cancelled";
  const awaitingPayment = order.payment_method === "online" && order.payment_status === "awaiting_payment" && !cancelled;

  return (
    <div className="min-h-screen pb-10">
      <header className={`border-b pt-[env(safe-area-inset-top)] ${hs.className}`} style={hs.style}>
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <Logo small />
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--hmuted,#556c4d)]">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-sage-500" : "bg-stone-400"}`} aria-hidden />
            {live ? "Live updates" : "Connecting…"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
        {isNew && !cancelled && !awaitingPayment && (
          <div className="rounded-3xl bg-sage-600 px-5 py-5 text-white">
            <p className="text-sm font-semibold uppercase tracking-wide text-sage-100">Thank you, {order.customer_name.split(" ")[0]}!</p>
            <p className="font-display text-2xl font-bold">Your order is in.</p>
            <p className="mt-1 text-sage-100">Keep this page open, or save the link, to follow your order.</p>
          </div>
        )}

        {native && !cancelled && order.status !== "completed" && push !== "enabled" && push !== "unavailable" && (
          <section className="card flex items-center gap-4 p-4">
            <span className="text-3xl" aria-hidden>
              🔔
            </span>
            <div className="flex-1">
              <p className="font-bold">Get notified when it&apos;s ready</p>
              <p className="text-sm text-coffee-700">
                {push === "denied" ? "Notifications are off for Isla. Turn them on in your phone's Settings." : "We'll send one alert per update. No ads, ever."}
              </p>
            </div>
            {push !== "denied" && (
              <button className="btn-sage btn-sm shrink-0" onClick={askPush} disabled={push === "asking"}>
                {push === "asking" ? "…" : "Notify me"}
              </button>
            )}
          </section>
        )}
        {native && push === "enabled" && !cancelled && order.status !== "completed" && (
          <p className="text-center text-sm font-medium text-sage-700">🔔 We&apos;ll notify you when your order status changes.</p>
        )}

        <section className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-coffee-600">Order number</p>
              <p className="font-display text-4xl font-bold tracking-wide">{order.order_number}</p>
              <p className="mt-1 text-sm text-coffee-700">
                {ORDER_TYPE_LABEL[order.order_type]} ·{" "}
                {order.scheduled_for ? `Scheduled ${formatTime(order.scheduled_for)}` : "ASAP"} · placed {formatDateTime(order.created_at)}
              </p>
            </div>
            <button onClick={share} className="btn-secondary btn-sm shrink-0">
              {copied ? "Link copied" : "Share"}
            </button>
          </div>

          {order.payment_method === "gcash" && !cancelled && (
            <div className="mt-4">
              {order.payment_status === "paid" ? (
                <Alert tone="green">GCash payment verified ✓</Alert>
              ) : (
                <Alert tone="amber">We&apos;re checking your GCash payment. This usually takes a few minutes.</Alert>
              )}
            </div>
          )}

          {order.payment_method === "online" && order.payment_status === "paid" && (
            <div className="mt-4">
              <Alert tone="green">Paid online ✓ — thank you!</Alert>
            </div>
          )}

          {awaitingPayment ? (
            <OnlinePaymentCard token={token} total={order.total} expiresAt={order.payment_expires_at} confirming={returnedFromPayment} onSwitched={load} />
          ) : cancelled ? (
            <div className="mt-5">
              <Alert>
                <p className="text-base font-bold">This order was cancelled.</p>
                {order.cancel_reason && <p className="font-normal">Reason: {order.cancel_reason}</p>}
                {order.payment_status === "refunded" && <p className="font-normal">Your online payment has been refunded.</p>}
                {order.payment_method === "online" && order.payment_status === "paid" && (
                  <p className="font-normal">Your online payment will be refunded by the café.</p>
                )}
                <p className="mt-1 font-normal">Sorry about that! Questions? Please call the café.</p>
              </Alert>
            </div>
          ) : (
            <ol className="mt-6" aria-label="Order progress">
              {flow.map((s, i) => {
                const done = i < currentIdx || order.status === "completed";
                const current = i === currentIdx; // the completed step stays "current" so its message shows
                const ts = order[s.at] as string | null;
                return (
                  <li key={s.status} className="relative flex gap-4 pb-6 last:pb-0" aria-current={current ? "step" : undefined}>
                    {i < flow.length - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 ${done ? "bg-sage-500" : "bg-coffee-100"}`} aria-hidden />}
                    <span
                      className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        done ? "bg-sage-600 text-white" : current ? "animate-new-order bg-coffee-700 text-cream" : "bg-coffee-100 text-coffee-500"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <div className="pt-1">
                      <p className={`font-bold ${!done && !current ? "text-coffee-500" : ""}`}>
                        {s.label}
                        {ts && (done || current) && <span className="ml-2 text-sm font-normal text-coffee-600">{formatTime(ts)}</span>}
                      </p>
                      {current && (
                        <p className="text-coffee-700">
                          {s.detail}
                          {s.status === "out_for_delivery" && order.rider_name && ` ${order.rider_name} is bringing it.`}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {chat && (
          <OrderChat
            orderId={chat.id}
            me="customer"
            otherName={order.rider_name}
            canSend={chat.riderAssigned && order.status !== "completed" && order.status !== "cancelled"}
            closedNote={
              order.status === "completed" || order.status === "cancelled"
                ? "This order is closed, so the chat is closed too."
                : "You can chat with your rider here once one is assigned to your order."
            }
          />
        )}

        <section className="card p-5">
          <h2 className="section-title mb-2">Your order</h2>
          <ul className="divide-y divide-coffee-100">
            {order.items.map((it, idx) => (
              <li key={idx} className="flex justify-between gap-3 py-2.5">
                <div>
                  <p className="font-semibold">
                    {it.quantity}× {it.item_name}
                  </p>
                  {it.options.length > 0 && <p className="text-sm text-coffee-700">{it.options.map((o) => o.name).join(" · ")}</p>}
                  {it.notes && <p className="text-sm italic text-coffee-600">“{it.notes}”</p>}
                </div>
                <span className="tabular-nums">{formatPeso(it.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-coffee-100 pt-3">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatPeso(order.subtotal)}</dd>
            </div>
            {order.order_type === "delivery" && (
              <div className="flex justify-between">
                <dt>Delivery ({order.zone_name})</dt>
                <dd className="tabular-nums">{formatPeso(order.delivery_fee)}</dd>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatPeso(order.total)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-sm">
              <dt className="text-coffee-700">Payment</dt>
              <dd>
                <Badge tone={order.payment_status === "paid" ? "green" : order.payment_status === "refunded" ? "gray" : "amber"}>
                  {order.payment_method === "gcash" ? "GCash" : order.payment_method === "online" ? "Online" : "Cash"} ·{" "}
                  {order.payment_status === "paid"
                    ? "Paid"
                    : order.payment_status === "refunded"
                      ? "Refunded"
                      : order.payment_status === "awaiting_payment"
                        ? "Not paid yet"
                        : order.payment_method === "gcash"
                          ? "Verifying"
                          : "Pay on receipt"}
                </Badge>
              </dd>
            </div>
          </dl>
          {order.order_type === "delivery" && (
            <p className="mt-3 text-sm text-coffee-700">
              Deliver to: {order.street}
              {order.landmark && ` (${order.landmark})`}, {order.zone_name}
            </p>
          )}
        </section>

        <Link href="/menu" className="btn-secondary w-full">
          Back to menu
        </Link>
      </main>
    </div>
  );
}

/** Shown while an online order is unpaid: resume HitPay checkout, with a countdown. */
function OnlinePaymentCard({ token, total, expiresAt, confirming, onSwitched }: { token: string; total: number; expiresAt: string | null; confirming: boolean; onSwitched: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRetry, setShowRetry] = useState(!confirming);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const r = confirming ? setTimeout(() => setShowRetry(true), 25_000) : undefined;
    return () => {
      clearInterval(t);
      if (r) clearTimeout(r);
    };
  }, [confirming]);

  // Ask the server to confirm with HitPay directly — covers a slow or missed webhook.
  // On return from HitPay: every 4 s for ~1 min; otherwise once when the page opens.
  useEffect(() => {
    let tries = 0;
    let stop = false;
    const check = async () => {
      if (stop) return;
      tries++;
      const res = await fetch("/api/payments/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (["paid", "already_paid", "paid_after_cancel"].includes(json.outcome)) return; // realtime/poll refreshes the page
      if (confirming && tries < 15) setTimeout(check, 4000);
    };
    check();
    return () => {
      stop = true;
    };
  }, [token, confirming]);
  const left = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : null;
  const expired = left === 0;
  const mm = left !== null ? Math.floor(left / 60000) : 0;
  const ss = left !== null ? Math.floor((left % 60000) / 1000) : 0;

  const pay = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.url) {
      window.location.href = json.url;
      return;
    }
    setBusy(false);
    setError(json.error ?? "Couldn't open the payment page. Please try again.");
  };

  if (expired)
    return (
      <div className="mt-5">
        <Alert>
          <p className="text-base font-bold">The payment window has closed.</p>
          <p className="font-normal">This order wasn&apos;t paid within 30 minutes, so it won&apos;t be prepared. Please place a new order.</p>
        </Alert>
        <Link href="/menu" className="btn-primary mt-3 w-full">
          Back to menu
        </Link>
      </div>
    );

  return (
    <div className="mt-5 space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" data-testid="online-payment-card">
      {confirming ? (
        <div className="flex items-center gap-3">
          <Spinner className="text-amber-700" />
          <div>
            <p className="font-bold text-amber-900">Confirming your payment…</p>
            <p className="text-sm text-amber-900">This usually takes a few seconds. Your order goes to the baristas as soon as it&apos;s confirmed.</p>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-base font-bold text-amber-900">Complete your payment</p>
          <p className="text-sm text-amber-900">
            Your order is waiting for payment of <strong>{formatPeso(total)}</strong> (GCash or QR Ph). We&apos;ll start preparing it once it&apos;s paid.
          </p>
        </div>
      )}
      {left !== null && (
        <p className="text-sm font-semibold text-amber-900" aria-live="off">
          Time left to pay: {mm}:{String(ss).padStart(2, "0")}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {showRetry && (
        <button className={confirming ? "btn-secondary w-full" : "btn-primary w-full"} onClick={pay} disabled={busy}>
          {busy ? <Spinner /> : confirming ? "Didn't finish paying? Pay now" : `Pay now · ${formatPeso(total)}`}
        </button>
      )}
      <GcashFallback token={token} amount={total} folder="proofs" endpoint="/api/payments/switch-to-gcash" onDone={onSwitched} />
    </div>
  );
}
