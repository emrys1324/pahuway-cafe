"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, PageLoader, Spinner } from "@/components/ui";
import { ScooterPhoto } from "./ScooterPhoto";
import { SignInGate } from "./SignInGate";
import { isPhoneLoginEmail } from "@/lib/phone-login";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { useStoreSettings } from "@/lib/store-settings";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso, friendlyError, normalizePhone } from "@/lib/format";
import { resizeImage } from "@/lib/upload";
import { addDays, getRecentBooking, hoursLabel, manilaDate, manilaInstant, nextPickupSlot, prettyDate, rentalQuote, rentalHours, securityFor, rentalSlots, saveRecentBooking, slotLabel, type RentalSettings, type Scooter } from "@/lib/rentals";


/** Baybayin booking (pickup only): calendar & times → scooter → details & license → agree to terms → GCash deposit receipt. */
export function ScooterBooking({ rs, brandName }: { rs: RentalSettings; brandName: string }) {
  const today = manilaDate();
  const { settings } = useStoreSettings();
  const hours = rentalHours(rs);
  const slots = useMemo(() => rentalSlots(hours.open, hours.close), [hours.open, hours.close]);
  const first = useMemo(() => nextPickupSlot(hours.open, hours.close), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [special, setSpecial] = useState(false);
  const [start, setStart] = useState(first.date);
  const [startTime, setStartTime] = useState(first.time);
  const [end, setEnd] = useState(addDays(first.date, 1));
  const [endTime, setEndTime] = useState(first.time);
  const [scooters, setScooters] = useState<Scooter[] | null>(null);
  const [busyList, setBusyList] = useState<string[]>([]);
  const [freeUnits, setFreeUnits] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [helmets, setHelmets] = useState(1);
  const [agreed, setAgreed] = useState(false);
  const [securityNow, setSecurityNow] = useState(false);
  const [method, setMethod] = useState<"online" | "gcash">(rs.online_enabled ? "online" : "gcash");
  const payOnline = rs.online_enabled && method === "online";
  const [proof, setProof] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [calKey, setCalKey] = useState(0);
  const [license, setLicense] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ token: string; number: string } | null>(null);

  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const needSignIn = settings?.require_account !== false && signedIn === false;

  useEffect(() => setRecent(getRecentBooking()), []);
  // signed-in customers: fill in their details from the account
  useEffect(() => {
    const supabase = getSupabase();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setSignedIn(!!auth.user);
      if (!auth.user) return;
      const { data: p } = await supabase.from("users").select("full_name, phone").eq("id", auth.user.id).single();
      if (p?.full_name) setName((v) => v || p.full_name);
      if (p?.phone) setPhone((v) => v || p.phone);
      const em = auth.user.email;
      if (em && !isPhoneLoginEmail(em)) setEmail((v) => v || em);
    })();
  }, []);
  useEffect(() => {
    getSupabase()
      .from("scooters")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name")
      .then(({ data }) => setScooters((data as Scooter[]) ?? []));
  }, []);

  const pickupMs = manilaInstant(start, startTime);
  const returnMs = manilaInstant(end, endTime);
  const pastPickup = !(pickupMs >= Date.now() - 15 * 60_000);
  const tooShort = !(returnMs >= pickupMs + 3_600_000);
  const validDates = !pastPickup && !tooShort;
  const maxExcess = Number(rs.max_excess_hours ?? 6);
  const excessRate = Number(rs.excess_hour_rate ?? 50);
  const quote = validDates ? rentalQuote(pickupMs, returnMs, maxExcess) : { days: 0, excessHours: 0 };
  const days = quote.days;
  const excessFee = quote.excessHours * excessRate;
  const priceFor = (sc: Scooter) => days * Number(sc.daily_rate) + excessFee;
  const tooLong = days > rs.max_days;
  const loadTaken = async () => {
    if (!validDates) return;
    const args = { p_pickup: new Date(pickupMs).toISOString(), p_return: new Date(returnMs).toISOString() };
    const [busy, avail] = await Promise.all([getSupabase().rpc("busy_scooters", args), getSupabase().rpc("scooter_availability", args)]);
    setBusyList(((busy.data as string[] | null) ?? []).map(String));
    setFreeUnits(Object.fromEntries(((avail.data as { scooter_id: string; free: number }[] | null) ?? []).map((a) => [a.scooter_id, a.free])));
  };
  useEffect(() => {
    loadTaken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, startTime, end, endTime]);
  useEffect(() => {
    if (!license) return setLicensePreview(null);
    const u = URL.createObjectURL(license);
    setLicensePreview(u);
    return () => URL.revokeObjectURL(u);
  }, [license]);

  useEffect(() => {
    if (!proof) return setProofPreview(null);
    const u = URL.createObjectURL(proof);
    setProofPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [proof]);

  const busyIds = useMemo(() => new Set(validDates ? busyList : []), [busyList, validDates]);
  useEffect(() => {
    if (pick && busyIds.has(pick)) setPick(null);
  }, [busyIds, pick]);

  const scooter = scooters?.find((s) => s.id === pick) ?? null;
  const total = scooter ? priceFor(scooter) : 0;
  const deposit = total ? Math.min(total, Math.max(1, Math.round((total * rs.deposit_percent) / 100))) : 0;
  const security = scooter ? securityFor(scooter, rs) : 0;
  const upfront = securityNow && security > 0;
  const payNow = deposit + (upfront ? security : 0);
  const atPickup = total - deposit + (upfront ? 0 : security);

  const errors: Record<string, string> = {};
  if (!validDates) errors.dates = pastPickup ? "That pickup time has passed. Please choose a later time." : "Return at least 1 hour after pickup.";
  else if (!slots.includes(startTime) || !slots.includes(endTime)) errors.dates = `Pickup and return are from ${slotLabel(hours.open)} to ${slotLabel(hours.close)}. Tick the box below to arrange another time.`;
  else if (tooLong) errors.dates = `Rentals can be up to ${rs.max_days} days.`;
  if (!scooter) errors.scooter = "Choose a scooter.";
  if (name.trim().length < 2) errors.name = "Please enter your name.";
  if (!normalizePhone(phone)) errors.phone = "Use the format 09XXXXXXXXX.";
  if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Please check your email.";
  if (!license) errors.license = "Please add a photo of your driver's license.";
  else if (license.size > 8 * 1024 * 1024) errors.license = "That photo is too large (max 8 MB).";
  if (!agreed) errors.terms = "Please read and agree to the terms and conditions.";
  else if (!payOnline) {
    if (!proof) errors.proof = "Please attach a screenshot of your GCash payment.";
    else if (proof.size > 5 * 1024 * 1024) errors.proof = "Screenshot is too large (max 5 MB).";
  }
  const show = (k: string) => (tried && errors[k] ? <p className="error-text">{errors[k]}</p> : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (special) return;
    setTried(true);
    setError(null);
    if (Object.keys(errors).length) {
      document.querySelector("[data-error=true]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const db = getSupabase();
      const blob = await resizeImage(license!, 1600);
      const ext = blob.type === "image/jpeg" ? "jpg" : (license!.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `licenses/${today}/${crypto.randomUUID()}.${ext}`;
      const up = await db.storage.from("license-photos").upload(path, blob, { contentType: blob.type || license!.type, upsert: false });
      if (up.error) throw new Error("We couldn't upload your license photo. Please try again. " + up.error.message);
      let proofPath: string | null = null;
      if (!payOnline) {
        const pblob = await resizeImage(proof!, 1600);
        const pext = pblob.type === "image/jpeg" ? "jpg" : (proof!.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        proofPath = `proofs/rentals/${today}/${crypto.randomUUID()}.${pext}`;
        const pup = await db.storage.from("payment-proofs").upload(proofPath, pblob, { contentType: pblob.type || proof!.type, upsert: false });
        if (pup.error) throw new Error("We couldn't upload your GCash screenshot. Please try again. " + pup.error.message);
      }
      const { data, error } = await db.rpc("book_scooter", {
        p: {
          scooter_id: scooter!.id,
          pickup_at: `${start}T${startTime}`,
          return_at: `${end}T${endTime}`,
          customer_name: name.trim(),
          customer_phone: normalizePhone(phone),
          customer_email: email.trim() || null,
          helmets,
          license_path: path,
          notes,
          terms_agreed: agreed,
          payment_method: payOnline ? "online" : "gcash",
          security_upfront: upfront,
          payment_proof_path: proofPath,
        },
      });
      if (error) {
        if (/UNAVAILABLE/.test(error.message)) {
          await loadTaken();
          setCalKey((k) => k + 1);
        }
        throw new Error(error.message);
      }
      saveRecentBooking(data.token, data.booking_number);
      if (payOnline) {
        const res = await fetch("/api/rentals/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: data.token }) });
        const j = await res.json().catch(() => ({}));
        window.location.href = res.ok && j.url ? j.url : `/baybayin/booking/${data.token}`; // the booking page offers "Pay now" again
        return;
      }
      await fetch("/api/rentals/new-booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: data.token }), keepalive: true }).catch(() => null);
      window.location.href = `/baybayin/booking/${data.token}`;
    } catch (err) {
      setError(friendlyError((err as Error).message));
      setBusy(false);
    }
  };

  if (!scooters || (settings?.require_account !== false && signedIn === undefined)) return <PageLoader />;
  return (
    <form onSubmit={submit} noValidate className="space-y-4 pb-32">
      {recent && (
        <Link href={`/baybayin/booking/${recent.token}`} className="block rounded-2xl bg-sky-100 px-4 py-3 text-sm font-semibold text-sky-900">
          Your booking {recent.number} → view status
        </Link>
      )}

      {/* 1 · Pickup & return */}
      <section className="card space-y-3 p-5" data-error={tried && !!errors.dates}>
        <h2 className="section-title">When?</h2>
        <p className="hint">All rentals are picked up{rs.pickup_note ? ` ${rs.pickup_note}` : " at our shop"}. Tap a day to set your pickup date.</p>
        <AvailabilityCalendar
          scooters={scooters}
          scooter={scooter}
          today={today}
          selected={start}
          refreshKey={calKey}
          onPick={(d) => {
            setStart(d);
            if (end <= d) setEnd(addDays(d, 1));
          }}
        />
        {(
          [
            ["pickup", "Pickup", start, startTime, today, (d: string) => {
              setStart(d);
              if (end < d) setEnd(addDays(d, 1));
            }, setStartTime],
            ["return", "Return", end, endTime, start, setEnd, setEndTime],
          ] as const
        ).map(([id, label, d, t, min, setD, setT]) => (
          <fieldset key={id} className="grid grid-cols-[1fr_auto] gap-2">
            <legend className="label">{label}</legend>
            <input id={`${id}-date`} aria-label={`${label} date`} type="date" className="input" min={min} max={addDays(today, 180)} value={d} onChange={(e) => setD(e.target.value)} />
            <select id={`${id}-time`} aria-label={`${label} time`} className="input w-32" value={t} onChange={(e) => setT(e.target.value)}>
              {slots.map((x) => (
                <option key={x} value={x}>
                  {slotLabel(x)}
                </option>
              ))}
            </select>
          </fieldset>
        ))}
        {validDates && !tooLong ? (
          <p className="hint" data-testid="rental-days">
            {prettyDate(start)}, {slotLabel(startTime)} → {prettyDate(end)}, {slotLabel(endTime)} · {hoursLabel(returnMs - pickupMs)} ·{" "}
            <strong>
              {days} day{days === 1 ? "" : "s"}
              {quote.excessHours > 0 && ` + ${quote.excessHours} hour${quote.excessHours === 1 ? "" : "s"}`}
            </strong>
            <br />
            Charged per 24 hours. Extra hours after full days: {formatPeso(excessRate)}/hour (up to {maxExcess}); {maxExcess + 1} or more extra hours count as another day.
          </p>
        ) : (
          <p className="error-text">{errors.dates}</p>
        )}
        <p className="text-sm text-coffee-700" data-testid="rental-hours">
          Pickup and return times: {slotLabel(hours.open)} – {slotLabel(hours.close)}.
        </p>
        <label className="flex items-start gap-3 font-medium">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-coffee-700" checked={special} onChange={(e) => setSpecial(e.target.checked)} />
          I need a pickup or return outside {slotLabel(hours.open)} – {slotLabel(hours.close)}
        </label>
        {special && <SpecialArrangement rs={rs} brandName={brandName} phone={settings?.contact_phone ?? null} hours={hours} />}
      </section>

      {!special && (
        <>
      {/* 2 · Scooter */}
      <section className="card space-y-3 p-5" data-error={tried && !!errors.scooter}>
        <h2 className="section-title">Choose a scooter</h2>
        {scooters.length === 0 && <p className="text-coffee-700">No scooters are available to book yet. Please check back soon.</p>}
        <div className="grid gap-3" role="radiogroup" aria-label="Scooter">
          {scooters.map((s) => {
            const booked = busyIds.has(s.id);
            const on = pick === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${s.name}${booked ? " (booked)" : ""}`}
                disabled={booked || !validDates}
                onClick={() => setPick(s.id)}
                data-testid="scooter-option"
                className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-coffee-700 bg-coffee-50" : "border-coffee-200 bg-white"}`}
              >
                <ScooterPhoto src={s.photo_url} alt={s.name} className="h-20 w-20 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{s.name}</span>
                  {s.description && <span className="block text-sm text-coffee-700">{s.description}</span>}
                  <span className="mt-1 block text-sm">
                    <strong className="tabular-nums">{formatPeso(s.daily_rate)}</strong>/day
                    {validDates && !tooLong && (days > 1 || quote.excessHours > 0) && (
                      <span className="text-coffee-700">
                        {" "}
                        · {formatPeso(priceFor(s))} for {days} day{days === 1 ? "" : "s"}
                        {quote.excessHours > 0 && ` + ${quote.excessHours} h`}
                      </span>
                    )}
                  </span>
                  {securityFor(s, rs) > 0 && <span className="block text-xs text-coffee-600">{formatPeso(securityFor(s, rs))} security deposit (refundable)</span>}
                </span>
                {booked && <Badge tone="gray">Booked</Badge>}
                {!booked && validDates && Number(s.units) > 1 && freeUnits[s.id] !== undefined && (
                  <Badge tone={freeUnits[s.id] === 1 ? "amber" : "green"}>
                    {freeUnits[s.id]} of {s.units} left
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
        {show("scooter")}
      </section>

      {needSignIn ? (
        <SignInGate next="/baybayin" what="book" />
      ) : (
        <>
      {/* 3 · Details */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">Your details</h2>
        <div data-error={tried && !!errors.name}>
          <label className="label" htmlFor="renter-name">
            Name (as on your license)
          </label>
          <input id="renter-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {show("name")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div data-error={tried && !!errors.phone}>
            <label className="label" htmlFor="renter-phone">
              Mobile number
            </label>
            <input id="renter-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {show("phone")}
          </div>
          <div data-error={tried && !!errors.email}>
            <label className="label" htmlFor="renter-email">
              Email <span className="font-normal text-coffee-600">(optional, for the receipt)</span>
            </label>
            <input id="renter-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {show("email")}
          </div>
        </div>
        <fieldset>
          <legend className="label">Helmets</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Helmets">
            {[0, 1, 2].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={helmets === n} onClick={() => setHelmets(n)} className={`rounded-xl border-2 py-2.5 font-semibold ${helmets === n ? "border-coffee-700 bg-coffee-50" : "border-coffee-200 bg-white"}`}>
                {n === 0 ? "None" : n === 1 ? "1 (rider)" : "2 (+ passenger)"}
              </button>
            ))}
          </div>
        </fieldset>
        <div data-error={tried && !!errors.license}>
          <span className="label">Driver&apos;s license photo</span>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-coffee-200 p-3">
            {licensePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={licensePreview} alt="Your license photo" className="h-16 w-24 rounded-lg object-cover" />
            ) : (
              <span aria-hidden className="flex h-16 w-24 items-center justify-center rounded-lg bg-cream text-2xl">
                🪪
              </span>
            )}
            <span className="text-sm">
              <span className="block font-semibold">{license ? "Change photo" : "Add a photo of your license"}</span>
              <span className="text-coffee-700">Only Baybayin staff can see it. JPG or PNG, max 5 MB.</span>
            </span>
            <input type="file" accept="image/*" className="sr-only" aria-label="Driver's license photo" onChange={(e) => setLicense(e.target.files?.[0] ?? null)} />
          </label>
          {show("license")}
        </div>
        <div>
          <label className="label" htmlFor="renter-notes">
            Notes <span className="font-normal text-coffee-600">(optional, e.g. pickup time)</span>
          </label>
          <input id="renter-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="I'll pick it up around 9 AM" />
        </div>
      </section>

      {/* 4 · Summary */}
      {scooter && validDates && !tooLong && (
        <section className="card space-y-2 p-5" data-testid="rental-summary">
          <h2 className="section-title">Summary</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt>
                {scooter.name} · {days} day{days === 1 ? "" : "s"} × {formatPeso(scooter.daily_rate)}
              </dt>
              <dd className="tabular-nums">{formatPeso(days * Number(scooter.daily_rate))}</dd>
            </div>
            {quote.excessHours > 0 && (
              <div className="flex justify-between gap-3" data-testid="excess-hours">
                <dt>
                  Extra {quote.excessHours} hour{quote.excessHours === 1 ? "" : "s"} × {formatPeso(excessRate)}
                </dt>
                <dd className="tabular-nums">{formatPeso(excessFee)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-coffee-100 pt-2 text-base font-bold">
              <dt>Total rental</dt>
              <dd className="tabular-nums">{formatPeso(total)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-semibold text-sage-700">
              <dt>Deposit ({rs.deposit_percent}%)</dt>
              <dd className="tabular-nums">{formatPeso(deposit)}</dd>
            </div>
            {upfront && (
              <div className="flex justify-between gap-3 font-semibold text-sage-700">
                <dt>
                  Security deposit <span className="font-normal">(refundable)</span>
                </dt>
                <dd className="tabular-nums">{formatPeso(security)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 font-bold text-sage-700" data-testid="pay-now">
              <dt>To pay now</dt>
              <dd className="tabular-nums">{formatPeso(payNow)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-coffee-100 pt-2">
              <dt>Rental balance</dt>
              <dd className="tabular-nums">{formatPeso(total - deposit)}</dd>
            </div>
            {security > 0 && !upfront && (
              <div className="flex justify-between gap-3" data-testid="security-deposit">
                <dt>
                  Security deposit at pickup <span className="text-coffee-600">(refundable)</span>
                </dt>
                <dd className="tabular-nums">{formatPeso(security)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 font-bold" data-testid="due-at-pickup">
              <dt>Total balance at pickup</dt>
              <dd className="tabular-nums">{formatPeso(atPickup)}</dd>
            </div>
          </dl>
          {security > 0 && (
            <label className="flex items-start gap-3 rounded-xl bg-cream-100 px-3 py-2 text-sm font-medium">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-coffee-700" checked={securityNow} onChange={(e) => setSecurityNow(e.target.checked)} />
              <span>
                Pay the {formatPeso(security)} security deposit now, together with the deposit
                <span className="block font-normal text-coffee-700">Leave unticked to pay it at pickup instead.</span>
              </span>
            </label>
          )}
          {security > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              The {formatPeso(security)} security deposit{rs.security_deposit_note ? ` (${rs.security_deposit_note})` : ""} is refunded when the scooter comes back in good condition.
            </p>
          )}
          <p className="hint">Pickup only{rs.pickup_note ? `: ${rs.pickup_note}` : ""}. Pay the balance when you pick up the scooter.</p>
        </section>
      )}

      {/* 5 · Terms, then GCash deposit */}
      <section className="card space-y-4 p-5">
        <h2 className="section-title">Terms and conditions</h2>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-cream-100 p-4 text-sm leading-relaxed text-coffee-800" data-testid="rental-terms" tabIndex={0} aria-label="Rental terms and conditions">
          {rs.terms}
        </div>
        <label className="flex items-start gap-3 font-medium" data-error={tried && !!errors.terms}>
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-coffee-700" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read and agree to the terms and conditions
        </label>
        {show("terms")}
        {agreed && rs.online_enabled && (
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Deposit payment">
            {(
              [
                ["online", "Pay online", "GCash, Maya, QR Ph or online banking · confirmed instantly"],
                ["gcash", "GCash (send manually)", "Send to our GCash and upload the receipt"],
              ] as const
            ).map(([v, title, sub]) => (
              <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)} className={`rounded-2xl border-2 px-4 py-3 text-left ${method === v ? "border-coffee-700 bg-coffee-50" : "border-coffee-100 bg-white"}`}>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-coffee-700">{sub}</span>
              </button>
            ))}
          </div>
        )}
        {agreed && payOnline && (
          <div className="rounded-2xl bg-cream-100 p-4 text-sm text-coffee-800" data-testid="online-payment">
            <p className="text-base font-semibold">To pay online: {payNow ? formatPeso(payNow) : "—"}</p>
            <p>You&apos;ll go to our secure payment page (HitPay) to pay with GCash, Maya or your bank app by scanning the QR Ph code, or with online banking. Your booking is confirmed as soon as the payment goes through. Please pay within 30 minutes.</p>
          </div>
        )}
        {agreed && !payOnline && (
          <div className="space-y-4 rounded-2xl bg-cream-100 p-4" data-testid="gcash-payment">
            <h3 className="font-semibold">Pay the deposit with GCash</h3>
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              {settings?.gcash_qr_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.gcash_qr_url} alt="GCash QR code" className="h-44 w-44 rounded-2xl bg-white p-2" />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-2xl bg-white p-4 text-sm text-coffee-600">QR not set up yet — use the number</div>
              )}
              <div>
                <p className="text-sm text-coffee-700">Send exactly</p>
                <p className="text-3xl font-bold tabular-nums" data-testid="gcash-amount">
                  {payNow ? formatPeso(payNow) : "—"}
                </p>
                {!deposit && <p className="text-sm text-coffee-600">Choose your dates and a scooter first.</p>}
                {settings?.gcash_name && <p className="mt-1 font-semibold">{settings.gcash_name}</p>}
                {settings?.gcash_number && <p className="font-mono text-lg">{settings.gcash_number}</p>}
                <p className="mt-1 text-sm text-coffee-600">Our staff will check your payment and confirm your booking.</p>
              </div>
            </div>
            <div data-error={tried && !!errors.proof}>
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
                <input type="file" accept="image/*" className="sr-only" aria-label="GCash payment screenshot" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
              </label>
              {show("proof")}
            </div>
          </div>
        )}
      </section>

      {error && <Alert>{error}</Alert>}
      <div className="fixed inset-x-0 bottom-[var(--nav-h,0px)] z-20 border-t border-coffee-100 bg-cream/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur [.has-bottom-nav_&]:pb-3">
        <div className="mx-auto max-w-lg">
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : agreed && deposit ? (payOnline ? `Pay ${formatPeso(payNow)} online` : `Book & send ${formatPeso(payNow)}`) : `Book a scooter from ${brandName}`}
          </button>
        </div>
      </div>
        </>
      )}
        </>
      )}
    </form>
  );
}

/** Shown instead of the booking form when the customer needs a time outside opening hours. */
function SpecialArrangement({ rs, brandName, phone, hours }: { rs: RentalSettings; brandName: string; phone: string | null; hours: { open: string; close: string } }) {
  const text = `Hi ${brandName}! I'd like to rent a scooter with a pickup or return outside ${slotLabel(hours.open)} – ${slotLabel(hours.close)}. Dates/times I need: `;
  let href = rs.messenger_url || null;
  if (href && /^https:\/\/(www\.)?m\.me\//.test(href)) href += (href.includes("?") ? "&" : "?") + "text=" + encodeURIComponent(text);
  return (
    <div className="space-y-3 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950" data-testid="special-arrangement">
      <p className="text-base font-semibold">Let&apos;s arrange it by message</p>
      <p>
        Online booking is for pickups and returns between {slotLabel(hours.open)} and {slotLabel(hours.close)}. For an earlier or later time, message {brandName} with the scooter, dates and times you need and we&apos;ll arrange it with you.
      </p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="btn-primary w-full" data-testid="messenger-link">
          💬 Message {brandName} on Messenger
        </a>
      ) : (
        <p className="font-semibold">Please message the {brandName} Facebook page{rs.pickup_note ? ` or drop by ${rs.pickup_note}` : ""}.</p>
      )}
      {phone && (
        <a href={`tel:${phone}`} className="btn-secondary w-full">
          📞 Call or text {phone}
        </a>
      )}
      <p className="text-xs text-sky-900">Untick the box above to book online within the regular hours instead.</p>
    </div>
  );
}
