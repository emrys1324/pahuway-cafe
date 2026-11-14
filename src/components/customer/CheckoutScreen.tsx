"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SignInGate } from "./SignInGate";
import { StoreHeader } from "./Header";
import { CartLines } from "./CartDrawer";
import { useMenu } from "./useMenu";
import { Alert, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useCart, saveRecentOrder } from "@/lib/cart";
import { formatPeso, friendlyError, normalizePhone } from "@/lib/format";
import { formatClock, timeSlots } from "@/lib/hours";
import { useStoreSettings } from "@/lib/store-settings";
import type { OrderType, PaymentMethod, Zone } from "@/lib/types";
import { MapPicker } from "@/components/map/MapPicker";
import { StreetAutocomplete } from "@/components/map/StreetAutocomplete";
import { useAddressSync } from "@/components/map/useAddressSync";
import { isLatLng, toLatLng, type LatLng } from "@/lib/maps";

const GUEST_KEY = "pahuway-guest-details";

const TYPES: { value: OrderType; label: string; icon: string; hint: string }[] = [
  { value: "delivery", label: "Delivery", icon: "🛵", hint: "To your door" },
  { value: "pickup", label: "Pickup", icon: "🛍️", hint: "Grab it at the counter" },
  { value: "dine_in", label: "Dine-in", icon: "☕", hint: "Ready when you arrive" },
];

/** Shrink big phone screenshots before upload (saves data on slow connections). */
async function compressImage(file: File): Promise<Blob> {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function CheckoutScreen() {
  const router = useRouter();
  const { lines, subtotal, clear, ready } = useCart();
  const { settings, open } = useStoreSettings();
  const { data: menu } = useMenu();
  const [zones, setZones] = useState<Zone[]>([]);

  const [orderType, setOrderType] = useState<OrderType>("delivery");
  const [when, setWhen] = useState<"asap" | "later">("asap");
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [riderNotes, setRiderNotes] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [proof, setProof] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const [tried, setTried] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [completedOrders, setCompletedOrders] = useState(0);

  // zones + prefill (signed-in profile first, else last guest details on this phone)
  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from("delivery_zones")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setZones((data as Zone[]) ?? []));
    (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || "null");
        if (saved) {
          setName(saved.name ?? "");
          setPhone(saved.phone ?? "");
          setZoneId(saved.zoneId ?? "");
          setStreet(saved.street ?? "");
          setLandmark(saved.landmark ?? "");
          if (isLatLng(saved.pin)) setPin(saved.pin);
        }
      } catch {}
      const { data: auth } = await supabase.auth.getUser();
      setSignedIn(!!auth.user);
      if (!auth.user) return;
      const { data: p } = await supabase.from("users").select("full_name, phone, zone_id, street, landmark, saved_lat, saved_lng").eq("id", auth.user.id).single();
      if (p) {
        if (p.full_name) setName(p.full_name);
        if (p.phone) setPhone(p.phone);
        if (p.zone_id) setZoneId(p.zone_id);
        if (p.street) setStreet(p.street);
        if (p.landmark) setLandmark(p.landmark);
        const savedPin = toLatLng(p.saved_lat, p.saved_lng);
        if (savedPin) setPin(savedPin);
      }
      // cash unlocks after N completed orders
      const { count: done } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", auth.user.id).eq("status", "completed");
      setCompletedOrders(done ?? 0);
    })();
  }, []);

  useEffect(() => {
    if (!proof) return setProofPreview(null);
    const url = URL.createObjectURL(proof);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  const slots = useMemo(() => (settings ? timeSlots(settings) : []), [settings, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const sync = useAddressSync({ zones, zoneId, setZoneId, street, setStreet, landmark, setLandmark, pin, setPin });
  const zone = zones.find((z) => z.id === zoneId);
  const fee = orderType === "delivery" && zone ? Number(zone.fee) : 0;
  const total = subtotal + fee;
  const minOrder = Number(settings?.min_delivery_order ?? 0);
  const belowMin = orderType === "delivery" && subtotal < minOrder;

  const unavailable = useMemo(() => {
    const s = new Set<string>();
    if (!menu) return s;
    const avail = new Map(menu.items.map((i) => [i.id, !i.is_sold_out]));
    lines.forEach((l) => !avail.get(l.menu_item_id) && s.add(l.menu_item_id));
    return s;
  }, [menu, lines]);

  if (!ready || !settings) return <PageLoader />;
  if (payment === "online" && !settings.online_payments_enabled) setTimeout(() => setPayment("cash"), 0);
  if (payment === "cash" && signedIn !== undefined && (settings.cash_after_orders ?? 3) > 0 && !(signedIn && completedOrders >= (settings.cash_after_orders ?? 3))) setTimeout(() => setPayment("gcash"), 0);

  if (lines.length === 0 && !done) {
    return (
      <div className="min-h-screen">
        <StoreHeader settings={settings} open={open} back="/menu" />
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-5xl" aria-hidden>
            🛒
          </p>
          <h1 className="mt-3 font-display text-2xl font-bold">Your cart is empty</h1>
          <Link href="/menu" className="btn-primary mt-6">
            Browse the menu
          </Link>
        </div>
      </div>
    );
  }

  if (settings.require_account !== false && !done) {
    if (signedIn === undefined) return <PageLoader />;
    if (!signedIn)
      return (
        <div className="min-h-screen">
          <StoreHeader settings={settings} open={open} back="/menu" />
          <main className="mx-auto max-w-lg px-4 py-6">
            <SignInGate next="/checkout" what="order" />
          </main>
        </div>
      );
  }

  // Errors are computed live once the customer has tried to submit, so they clear as fields are fixed.
  const computeErrors = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Please enter your name.";
    if (!normalizePhone(phone)) e.phone = "Use the format 09XXXXXXXXX (11 digits).";
    if (when === "later" && !slot) e.slot = "Please pick a time.";
    if (orderType === "delivery") {
      if (!zoneId) e.zone = "Please choose your barangay.";
      if (!street.trim()) e.street = "Please tell our rider where to go.";
      if (belowMin) e.min = `Minimum order for delivery is ${formatPeso(minOrder)}.`;
    }
    if (payment === "gcash") {
      if (!proof) e.proof = "Please attach a screenshot of your payment.";
      else if (proof.size > 5 * 1024 * 1024) e.proof = "Screenshot is too large (max 5 MB).";
    }
    if (unavailable.size) e.items = "Some items just sold out. Please remove them.";
    return e;
  };
  const errors = tried ? computeErrors() : {};

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitError(null);
    setTried(true);
    if (Object.keys(computeErrors()).length) {
      setTimeout(() => document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      let proofPath: string | null = null;
      if (payment === "gcash" && proof) {
        const blob = await compressImage(proof);
        const ext = blob.type === "image/jpeg" ? "jpg" : (proof.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const day = new Date().toISOString().slice(0, 10);
        proofPath = `proofs/${day}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("payment-proofs").upload(proofPath, blob, { contentType: blob.type || proof.type, upsert: false });
        if (upErr) throw new Error("We couldn't upload your screenshot. Please try again. " + upErr.message);
      }

      const { data, error } = await supabase.rpc("place_order", {
        p_order: {
          customer_name: name.trim(),
          customer_phone: normalizePhone(phone),
          order_type: orderType,
          scheduled_for: when === "later" ? slot : null,
          zone_id: orderType === "delivery" ? zoneId : null,
          street,
          landmark,
          rider_notes: riderNotes,
          lat: orderType === "delivery" && pin ? pin.lat : null,
          lng: orderType === "delivery" && pin ? pin.lng : null,
          payment_method: payment,
          gcash_reference: null,
          payment_proof_path: proofPath,
        },
        p_items: lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, option_ids: l.options.map((o) => o.id), notes: l.notes })),
      });
      if (error) throw new Error(error.message);

      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify({ name: name.trim(), phone: normalizePhone(phone), zoneId, street, landmark, pin: orderType === "delivery" ? pin : undefined }));
      } catch {}
      if (orderType === "delivery" && pin) {
        // remember the pin on a signed-in customer's account for next time (best effort)
        const { data: auth } = await supabase.auth.getUser();
        if (auth.user) await supabase.from("users").update({ saved_lat: pin.lat, saved_lng: pin.lng }).eq("id", auth.user.id);
      }
      saveRecentOrder({ token: data.token, order_number: data.order_number, created_at: new Date().toISOString() });
      setDone(true);
      clear();
      if (payment === "online") {
        // Hand over to HitPay's secure page; if that fails, the status page offers "Pay now" again.
        const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: data.token }) });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.url) {
          window.location.href = json.url;
          return;
        }
      }
      router.replace(`/order/${data.token}?new=1`);
    } catch (err) {
      setSubmitError(friendlyError((err as Error).message));
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (done) return <PageLoader />;

  const cashLabel = orderType === "delivery" ? "Cash on delivery" : orderType === "pickup" ? "Cash on pickup" : "Pay at the counter";
  const cashAfter = settings.cash_after_orders ?? 3;
  const cashAllowed = cashAfter === 0 || (!!signedIn && completedOrders >= cashAfter);
  const cashLockedNote = signedIn
    ? `Unlocks after ${cashAfter} completed orders (${Math.min(completedOrders, cashAfter)} of ${cashAfter} so far)`
    : `Sign in — unlocks after ${cashAfter} completed orders`;

  return (
    <div className="min-h-screen pb-36">
      <StoreHeader settings={settings} open={open} back="/menu" />
      <form onSubmit={submit} noValidate className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        <h1 className="font-display text-2xl font-bold">Checkout</h1>

        {!open && (
          <Alert tone="amber">
            <p className="font-bold">We&apos;re closed right now.</p>
            <p className="font-normal">
              {settings.closed_message} {settings.is_open && `Ordering opens at ${formatClock(settings.open_time)}.`}
            </p>
          </Alert>
        )}
        {submitError && <Alert>{submitError}</Alert>}

        {/* 1 · Order type + time */}
        <section className="card space-y-4 p-5">
          <h2 className="section-title">How would you like it?</h2>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Order type">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                role="radio"
                aria-checked={orderType === t.value}
                onClick={() => setOrderType(t.value)}
                className={`flex min-h-[88px] flex-col items-center justify-center rounded-2xl border-2 px-2 text-center transition ${
                  orderType === t.value ? "border-coffee-700 bg-coffee-50" : "border-coffee-100 bg-white"
                }`}
              >
                <span className="text-2xl" aria-hidden>
                  {t.icon}
                </span>
                <span className="font-bold">{t.label}</span>
                <span className="hidden text-xs text-coffee-600 sm:block">{t.hint}</span>
              </button>
            ))}
          </div>

          <div>
            <span className="label">When?</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={when === "asap"}
                onClick={() => setWhen("asap")}
                className={`chip justify-center ${when === "asap" ? "border-coffee-700 bg-coffee-700 text-cream" : "border-coffee-200 bg-white"}`}
              >
                ASAP
              </button>
              <button
                type="button"
                aria-pressed={when === "later"}
                onClick={() => setWhen("later")}
                disabled={slots.length === 0}
                className={`chip justify-center disabled:opacity-40 ${when === "later" ? "border-coffee-700 bg-coffee-700 text-cream" : "border-coffee-200 bg-white"}`}
              >
                Schedule
              </button>
            </div>
            {when === "asap" && (
              <p className="hint">Usually ready in ~{settings.prep_minutes}–{settings.prep_minutes + (orderType === "delivery" ? 20 : 5)} minutes.</p>
            )}
            {when === "later" && (
              <div className="mt-3" data-error={!!errors.slot}>
                <label className="label" htmlFor="slot">
                  Choose a time today
                </label>
                <select id="slot" className="input" value={slot} onChange={(e) => setSlot(e.target.value)}>
                  <option value="">Select a time…</option>
                  {slots.map((s) => (
                    <option key={s.iso} value={s.iso}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {errors.slot && <p className="error-text">{errors.slot}</p>}
              </div>
            )}
          </div>
        </section>

        {/* 2 · Contact + delivery */}
        <section className="card space-y-4 p-5">
          <h2 className="section-title">Your details</h2>
          <div data-error={!!errors.name}>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Juan Dela Cruz" />
            {errors.name && <p className="error-text">{errors.name}</p>}
          </div>
          <div data-error={!!errors.phone}>
            <label className="label" htmlFor="phone">
              Mobile number
            </label>
            <input
              id="phone"
              className="input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX"
              maxLength={16}
            />
            {errors.phone ? <p className="error-text">{errors.phone}</p> : <p className="hint">We&apos;ll only call if there&apos;s a problem with your order.</p>}
          </div>

          {orderType === "delivery" && (
            <>
              <div data-error={!!errors.zone}>
                <label className="label" htmlFor="zone">
                  Barangay
                </label>
                <select id="zone" className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">Select your barangay…</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} — {formatPeso(z.fee)} delivery
                    </option>
                  ))}
                </select>
                {errors.zone ? <p className="error-text">{errors.zone}</p> : <p className="hint">Don&apos;t see your area? We don&apos;t deliver there yet — try pickup.</p>}
              </div>
              <MapPicker value={pin} onChange={sync.onPinChange} center={sync.center} note={sync.note} />
              <div data-error={!!errors.street}>
                <label className="label" htmlFor="street">
                  House no. / Street / Purok
                </label>
                <StreetAutocomplete id="street" value={street} onChange={setStreet} onPick={sync.onSuggestion} enabled={sync.enabled} placeholder="Purok 3, Rizal St." />
                {errors.street && <p className="error-text">{errors.street}</p>}
              </div>
              <div>
                <label className="label" htmlFor="landmark">
                  Landmark <span className="font-normal text-coffee-600">(optional)</span>
                </label>
                <input id="landmark" className="input" value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={160} placeholder="Blue gate beside the chapel" />
              </div>
              <div>
                <label className="label" htmlFor="rider-notes">
                  Notes to rider <span className="font-normal text-coffee-600">(optional)</span>
                </label>
                <input id="rider-notes" className="input" value={riderNotes} onChange={(e) => setRiderNotes(e.target.value)} maxLength={200} placeholder="Please call when you're near" />
              </div>
            </>
          )}
        </section>

        {/* 3 · Payment */}
        <section className="card space-y-4 p-5">
          <h2 className="section-title">Payment</h2>
          <div className={`grid gap-2 ${settings.online_payments_enabled ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} role="radiogroup" aria-label="Payment method">
            {(
              [
                ...(settings.online_payments_enabled ? [{ v: "online", title: "Pay online", sub: "GCash or QR Ph · confirmed instantly" } as const] : []),
                { v: "cash", title: cashLabel, sub: cashAllowed ? "Pay when you get your order" : cashLockedNote, locked: !cashAllowed } as const,
                {
                  v: "gcash",
                  title: settings.online_payments_enabled ? "GCash (send manually)" : "GCash",
                  sub: "Send to our number, upload the receipt",
                } as const,
              ]
            ).map((p) => (
              <button
                type="button"
                key={p.v}
                role="radio"
                aria-checked={payment === p.v}
                aria-disabled={"locked" in p && p.locked ? true : undefined}
                disabled={"locked" in p && p.locked}
                data-testid={`pay-${p.v}`}
                onClick={() => setPayment(p.v)}
                className={`rounded-2xl border-2 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${payment === p.v ? "border-coffee-700 bg-coffee-50" : "border-coffee-100 bg-white"}`}
              >
                <span className="block font-bold">
                  {"locked" in p && p.locked && <span aria-hidden>🔒 </span>}
                  {p.title}
                </span>
                <span className="block text-sm text-coffee-600">{p.sub}</span>
              </button>
            ))}
          </div>

          {payment === "online" && (
            <div className="rounded-2xl bg-sage-100 p-4 text-sm text-sage-700" data-testid="online-pay-info">
              <p className="font-bold">You&apos;ll pay {formatPeso(total)} on HitPay&apos;s secure page.</p>
              <p>Pay with GCash, Maya or your bank app by scanning the QR Ph code, or with online banking. Your order goes to our baristas as soon as the payment is confirmed. Please pay within 30 minutes.</p>
            </div>
          )}

          {payment === "gcash" && (
            <div className="space-y-4 rounded-2xl bg-cream-100 p-4">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                {settings.gcash_qr_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.gcash_qr_url} alt="Pahuway Cafe GCash QR code" className="h-44 w-44 rounded-2xl bg-white p-2" />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center rounded-2xl bg-white p-4 text-sm text-coffee-600">QR not set up yet — use the number</div>
                )}
                <div>
                  <p className="text-sm text-coffee-700">Send exactly</p>
                  <p className="text-3xl font-bold tabular-nums">{formatPeso(total)}</p>
                  {settings.gcash_name && <p className="mt-1 font-semibold">{settings.gcash_name}</p>}
                  {settings.gcash_number && <p className="font-mono text-lg">{settings.gcash_number}</p>}
                  <p className="mt-1 text-sm text-coffee-600">Our staff will verify your payment before preparing.</p>
                </div>
              </div>
              <div data-error={!!errors.proof}>
                <span className="label">Payment screenshot</span>
                <label className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-coffee-300 bg-white px-4 py-3">
                  {proofPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proofPreview} alt="Payment screenshot preview" className="h-16 w-12 rounded-lg object-cover" />
                  ) : (
                    <span className="text-2xl" aria-hidden>
                      📎
                    </span>
                  )}
                  <span className="font-semibold text-coffee-800">{proof ? "Change screenshot" : "Attach screenshot"}</span>
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
                </label>
                {errors.proof && <p className="error-text">{errors.proof}</p>}
              </div>
            </div>
          )}
        </section>

        {/* 4 · Summary */}
        <section className="card p-5" data-error={!!errors.items || !!errors.min}>
          <div className="flex items-center justify-between">
            <h2 className="section-title">Order summary</h2>
            <Link href="/menu" className="text-sm font-semibold text-coffee-700 underline underline-offset-2">
              + Add more
            </Link>
          </div>
          <CartLines soldOutIds={unavailable} compact />
          <dl className="space-y-1.5 border-t border-coffee-100 pt-3">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatPeso(subtotal)}</dd>
            </div>
            {orderType === "delivery" && (
              <div className="flex justify-between">
                <dt>Delivery fee {zone && <span className="text-coffee-600">({zone.name})</span>}</dt>
                <dd className="tabular-nums">{zone ? formatPeso(fee) : "—"}</dd>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatPeso(total)}</dd>
            </div>
          </dl>
          {belowMin && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Add {formatPeso(minOrder - subtotal)} more to reach the {formatPeso(minOrder)} delivery minimum.
            </p>
          )}
          {errors.items && <p className="error-text">{errors.items}</p>}
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-coffee-100 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <button type="submit" className="btn-primary w-full py-4 text-lg" disabled={submitting || !open || unavailable.size > 0}>
              {submitting ? (
                <>
                  <Spinner /> Placing order…
                </>
              ) : !open ? (
                "Ordering is closed"
              ) : (
                <>{payment === "online" ? "Continue to payment" : "Place order"} · {formatPeso(total)}</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
