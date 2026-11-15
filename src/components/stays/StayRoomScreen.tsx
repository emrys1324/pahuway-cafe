"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { SignInGate } from "@/components/customer/SignInGate";
import { Alert, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso, friendlyError, normalizePhone } from "@/lib/format";
import { isPhoneLoginEmail } from "@/lib/phone-login";
import { resizeImage } from "@/lib/upload";
import { useStoreSettings } from "@/lib/store-settings";
import { manilaDate, monthGrid, monthLabel } from "@/lib/rentals";
import { addDaysYmd, clock, nightsBetween, prettyYmd, stayQuote, staysOpen, useStaySettings, type StayProperty, type StayRoom } from "@/lib/stays";

type Room = StayRoom & { stay_properties: StayProperty };

/** One room type: photos, amenities, rules, availability calendar and the booking form (30% GCash deposit). */
export function StayRoomScreen({ id }: { id: string }) {
  const { settings, open } = useStoreSettings();
  const ss = useStaySettings();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  useEffect(() => {
    getSupabase()
      .from("stay_rooms")
      .select("*, stay_properties(*)")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data }) => setRoom(data && (data as Room).stay_properties?.is_active ? (data as Room) : null));
  }, [id]);

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" back="/stays" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {room === undefined || !ss ? (
          <PageLoader />
        ) : room === null ? (
          <section className="card p-6 text-center">
            <p className="font-bold">This room isn&apos;t available.</p>
            <Link href="/stays" className="btn-primary mt-3 inline-flex">
              See all stays
            </Link>
          </section>
        ) : (
          <>
            <RoomInfo room={room} />
            {staysOpen(ss) ? (
              <StayBookingForm room={room} deposit={ss.deposit_percent} freeCancel={ss.free_cancel_days} maxNights={ss.max_nights} terms={ss.terms ?? ""} />
            ) : (
              <section className="card p-5 text-center" data-testid="stays-soon">
                <p className="font-bold">Bookings open soon</p>
                <p className="text-coffee-700">You&apos;ll be able to book this room right here.</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function RoomInfo({ room }: { room: Room }) {
  const p = room.stay_properties;
  const photos = [...room.photos, ...p.photos];
  const amenities = [...new Set([...p.amenities, ...room.amenities])];
  const [i, setI] = useState(0);
  return (
    <>
      <div className="overflow-hidden rounded-3xl bg-coffee-100" data-testid="stay-gallery">
        {photos.length ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[i]} alt={room.name} className="aspect-[16/10] w-full object-cover" />
            {photos.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-2">
                {photos.map((u, k) => (
                  <button key={u + k} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`} className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg ${k === i ? "ring-2 ring-coffee-800" : "opacity-70"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <span aria-hidden className="flex aspect-[16/10] items-center justify-center text-6xl">
            🛏️
          </span>
        )}
      </div>
      <section className="card space-y-3 p-5">
        <div>
          <h1 className="font-display text-2xl font-bold">{room.name}</h1>
          <p className="text-coffee-700">
            {p.name}
            {p.location_text ? ` · ${p.location_text}` : ""}
          </p>
          {p.map_url && (
            <a href={p.map_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-orange-700 underline">
              Open in Maps
            </a>
          )}
        </div>
        <p className="font-semibold" data-testid="stay-rates">
          {formatPeso(room.nightly_rate)} / night
          {room.weekend_rate != null && Number(room.weekend_rate) !== Number(room.nightly_rate) && <span className="font-normal text-coffee-700"> · Fri & Sat {formatPeso(room.weekend_rate)}</span>}
        </p>
        <p className="text-sm text-coffee-700">
          Up to {room.max_guests} guest{room.max_guests > 1 ? "s" : ""}
          {room.min_nights > 1 ? ` · minimum ${room.min_nights} nights` : ""} · Check-in from {clock(p.check_in_time)} · Check-out by {clock(p.check_out_time)}
        </p>
        {(room.description || p.description) && <p className="whitespace-pre-wrap text-coffee-800">{room.description || p.description}</p>}
        {amenities.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Amenities" data-testid="stay-amenities">
            {amenities.map((a) => (
              <li key={a} className="rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800 ring-1 ring-orange-200">
                {a}
              </li>
            ))}
          </ul>
        )}
        {p.house_rules && (
          <details className="rounded-2xl bg-cream-100 p-3 text-sm">
            <summary className="cursor-pointer font-semibold">House rules</summary>
            <p className="mt-2 whitespace-pre-wrap">{p.house_rules}</p>
          </details>
        )}
      </section>
    </>
  );
}

/** Month calendar: nights when this room type is fully booked are struck through. Tap check-in, then check-out. */
function StayCalendar({ roomId, today, checkIn, checkOut, onPick, refreshKey }: { roomId: string; today: string; checkIn: string; checkOut: string; onPick: (d: string) => void; refreshKey: number }) {
  const [ym, setYm] = useState(() => ({ y: Number(checkIn.slice(0, 4)), m: Number(checkIn.slice(5, 7)) - 1 }));
  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const first = grid.find(Boolean)!;
  const last = [...grid].reverse().find(Boolean)!;
  const [full, setFull] = useState<Set<string>>(new Set());
  useEffect(() => {
    getSupabase()
      .rpc("stay_full_nights", { p_room: roomId, p_from: first, p_to: addDaysYmd(last, 1) })
      .then(({ data }) => setFull(new Set(((data as string[] | null) ?? []).map(String))));
  }, [roomId, first, last, refreshKey]);
  const cur = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
  const maxMonth = addDaysYmd(today, 365).slice(0, 7);
  const shift = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <div className="space-y-2" data-testid="stay-calendar" data-month={cur}>
      <div className="flex items-center justify-between">
        <button type="button" className="btn-ghost btn-sm" onClick={() => shift(-1)} disabled={cur <= today.slice(0, 7)} aria-label="Previous month">
          ‹
        </button>
        <p className="font-semibold">{monthLabel(ym.y, ym.m)}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => shift(1)} disabled={cur >= maxMonth} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-coffee-600">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Availability calendar">
        {grid.map((d, k) => {
          if (!d) return <span key={k} />;
          const past = d < today;
          const booked = full.has(d);
          const inRange = d >= checkIn && d < checkOut;
          const edge = d === checkIn || d === checkOut;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              disabled={past}
              aria-label={`${d}: ${past ? "past" : booked ? "booked" : "free"}`}
              aria-selected={inRange || edge}
              data-day={d}
              data-tone={past ? "past" : booked ? "booked" : "free"}
              onClick={() => onPick(d)}
              className={`aspect-square rounded-lg text-sm font-semibold ${past ? "text-coffee-300" : booked ? "bg-stone-200 text-stone-500 line-through" : inRange ? "bg-orange-200 text-orange-900" : "bg-sage-100 text-sage-700"} ${edge ? "ring-2 ring-coffee-800 ring-offset-1" : ""}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-coffee-700">
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-sage-100 align-middle" /> free
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-orange-200 align-middle" /> your nights
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded bg-stone-200 align-middle" /> booked
        </span>
      </p>
    </div>
  );
}

const extOf = (blob: Blob, f: File) => (blob.type === "image/jpeg" ? "jpg" : (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, ""));

function StayBookingForm({ room, deposit: pct, freeCancel, maxNights, terms }: { room: Room; deposit: number; freeCancel: number; maxNights: number; terms: string }) {
  const { settings } = useStoreSettings();
  const today = manilaDate();
  const [checkIn, setCheckIn] = useState(addDaysYmd(today, 1));
  const [checkOut, setCheckOut] = useState(addDaysYmd(today, 1 + Math.max(1, room.min_nights)));
  const [picking, setPicking] = useState<"in" | "out">("in");
  const [guests, setGuests] = useState(Math.min(2, room.max_guests));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [idPhoto, setIdPhoto] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calKey, setCalKey] = useState(0);
  const [full, setFull] = useState<string[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

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

  const nights = nightsBetween(checkIn, checkOut);
  const validDates = checkIn >= today && nights >= 1;
  useEffect(() => {
    if (!validDates) return setFull([]);
    getSupabase()
      .rpc("stay_full_nights", { p_room: room.id, p_from: checkIn, p_to: checkOut })
      .then(({ data }) => setFull(((data as string[] | null) ?? []).map(String)));
  }, [room.id, checkIn, checkOut, validDates, calKey]);

  const q = validDates ? stayQuote(room, checkIn, checkOut) : null;
  const total = q?.total ?? 0;
  const deposit = total ? Math.min(total, Math.max(1, Math.round((total * pct) / 100))) : 0;

  const errors: Record<string, string> = {};
  if (!validDates) errors.dates = checkIn < today ? "Check-in can't be in the past." : "Check-out must be after check-in.";
  else if (nights < room.min_nights) errors.dates = `This room needs at least ${room.min_nights} nights.`;
  else if (nights > maxNights) errors.dates = `Stays can be up to ${maxNights} nights.`;
  else if (full.length) errors.dates = `Fully booked on ${full.map(prettyYmd).join(", ")}. Please choose other dates.`;
  if (name.trim().length < 2) errors.name = "Please enter your name.";
  if (!normalizePhone(phone)) errors.phone = "Use the format 09XXXXXXXXX.";
  if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Please check your email.";
  if (!idPhoto) errors.id = "Please add a photo of a valid ID.";
  else if (idPhoto.size > 8 * 1024 * 1024) errors.id = "That photo is too large (max 8 MB).";
  if (!agreed) errors.terms = "Please read and agree to the house rules and cancellation policy.";
  else if (!proof) errors.proof = "Please attach a screenshot of your GCash deposit.";
  else if (proof.size > 5 * 1024 * 1024) errors.proof = "Screenshot is too large (max 5 MB).";
  const show = (k: string) => (tried && errors[k] ? <p className="error-text">{errors[k]}</p> : null);

  const pickDay = (d: string) => {
    if (picking === "in" || d <= checkIn) {
      setCheckIn(d);
      if (checkOut <= d || nightsBetween(d, checkOut) < room.min_nights) setCheckOut(addDaysYmd(d, Math.max(1, room.min_nights)));
      setPicking("out");
    } else {
      setCheckOut(d);
      setPicking("in");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (Object.keys(errors).length) {
      document.querySelector("[data-error=true]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const db = getSupabase();
      const iblob = await resizeImage(idPhoto!, 1600);
      const idPath = `licenses/stays/${today}/${crypto.randomUUID()}.${extOf(iblob, idPhoto!)}`;
      const iu = await db.storage.from("license-photos").upload(idPath, iblob, { contentType: iblob.type || idPhoto!.type, upsert: false });
      if (iu.error) throw new Error("We couldn't upload your ID photo. Please try again. " + iu.error.message);
      const pblob = await resizeImage(proof!, 1600);
      const proofPath = `proofs/stays/${today}/${crypto.randomUUID()}.${extOf(pblob, proof!)}`;
      const pu = await db.storage.from("payment-proofs").upload(proofPath, pblob, { contentType: pblob.type || proof!.type, upsert: false });
      if (pu.error) throw new Error("We couldn't upload your GCash screenshot. Please try again. " + pu.error.message);
      const { data, error } = await db.rpc("book_stay", {
        p: {
          room_id: room.id,
          check_in: checkIn,
          check_out: checkOut,
          guests,
          customer_name: name.trim(),
          customer_phone: normalizePhone(phone),
          customer_email: email.trim() || null,
          id_photo_path: idPath,
          payment_proof_path: proofPath,
          notes,
          terms_agreed: agreed,
        },
      });
      if (error) {
        if (/UNAVAILABLE/.test(error.message)) setCalKey((k) => k + 1);
        throw new Error(error.message);
      }
      window.location.href = `/stays/booking/${data.token}`;
    } catch (err) {
      setError(friendlyError((err as Error).message));
      setBusy(false);
    }
  };

  if (settings?.require_account !== false && signedIn === undefined) return <PageLoader />;
  if (settings?.require_account !== false && signedIn === false) return <SignInGate next={`/stays/${room.id}`} what="book" thing="a stay" />;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pb-32" data-testid="stay-form">
      <section className="card space-y-3 p-5" data-error={tried && !!errors.dates}>
        <h2 className="section-title">When?</h2>
        <p className="hint">Tap your check-in day, then your check-out day.</p>
        <StayCalendar roomId={room.id} today={today} checkIn={checkIn} checkOut={checkOut} onPick={pickDay} refreshKey={calKey} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Check-in</span>
            <input
              type="date"
              className="input"
              aria-label="Check-in date"
              min={today}
              max={addDaysYmd(today, 365)}
              value={checkIn}
              onChange={(e) => {
                const d = e.target.value;
                setCheckIn(d);
                if (checkOut <= d) setCheckOut(addDaysYmd(d, Math.max(1, room.min_nights)));
              }}
            />
          </label>
          <label className="block">
            <span className="label">Check-out</span>
            <input type="date" className="input" aria-label="Check-out date" min={addDaysYmd(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </label>
        </div>
        {validDates && !errors.dates ? (
          <p className="hint" data-testid="stay-nights">
            {prettyYmd(checkIn)} → {prettyYmd(checkOut)} ·{" "}
            <strong>
              {nights} night{nights === 1 ? "" : "s"}
            </strong>
          </p>
        ) : (
          <p className="error-text">{errors.dates}</p>
        )}
        <label className="block">
          <span className="label">Guests</span>
          <select className="input" aria-label="Guests" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
            {Array.from({ length: room.max_guests }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n} guest{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="section-title">Your details</h2>
        <div data-error={tried && !!errors.name}>
          <label className="label" htmlFor="guest-name">
            Name (as on your ID)
          </label>
          <input id="guest-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {show("name")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-error={tried && !!errors.phone}>
            <label className="label" htmlFor="guest-phone">
              Mobile number
            </label>
            <input id="guest-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {show("phone")}
          </div>
          <div data-error={tried && !!errors.email}>
            <label className="label" htmlFor="guest-email">
              Email (optional)
            </label>
            <input id="guest-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {show("email")}
          </div>
        </div>
        <div data-error={tried && !!errors.id}>
          <span className="label">Photo of a valid ID</span>
          <FilePick file={idPhoto} onFile={setIdPhoto} label="Valid ID photo" hint="Driver's license, passport, UMID or national ID — only staff can see it." />
          {show("id")}
        </div>
        <div>
          <label className="label" htmlFor="guest-notes">
            Notes (optional)
          </label>
          <input id="guest-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="We'll arrive around 3 PM" />
        </div>
      </section>

      {q && !errors.dates && (
        <section className="card space-y-2 p-5" data-testid="stay-summary">
          <h2 className="section-title">Summary</h2>
          {q.weekday > 0 && (
            <p className="flex justify-between">
              <span>
                {q.weekday} night{q.weekday > 1 ? "s" : ""} × {formatPeso(q.weekdayRate)}
              </span>
              <span className="tabular-nums">{formatPeso(q.weekday * q.weekdayRate)}</span>
            </p>
          )}
          {q.weekend > 0 && (
            <p className="flex justify-between">
              <span>
                {q.weekend} Fri/Sat night{q.weekend > 1 ? "s" : ""} × {formatPeso(q.weekendRate)}
              </span>
              <span className="tabular-nums">{formatPeso(q.weekend * q.weekendRate)}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-coffee-100 pt-2 font-bold">
            <span>Total</span>
            <span className="tabular-nums" data-testid="stay-total">
              {formatPeso(total)}
            </span>
          </p>
          <p className="flex justify-between text-orange-800">
            <span>Deposit now ({pct}%)</span>
            <span className="font-bold tabular-nums" data-testid="stay-deposit">
              {formatPeso(deposit)}
            </span>
          </p>
          <p className="flex justify-between text-coffee-700">
            <span>Balance at check-in</span>
            <span className="tabular-nums">{formatPeso(total - deposit)}</span>
          </p>
        </section>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="section-title">House rules &amp; cancellation</h2>
        <p className="rounded-xl bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900" data-testid="cancel-policy">
          Free cancellation up to {freeCancel} day{freeCancel === 1 ? "" : "s"} before check-in — your deposit is refunded. Later than that, the deposit is kept.
        </p>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-cream-100 p-4 text-sm leading-relaxed text-coffee-800" data-testid="stay-terms" tabIndex={0} aria-label="Stay terms">
          {terms}
        </div>
        <label className="flex items-start gap-3 font-medium" data-error={tried && !!errors.terms}>
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-coffee-700" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I have read and agree to the house rules and cancellation policy
        </label>
        {show("terms")}
        {agreed && (
          <div className="space-y-4 rounded-2xl bg-cream-100 p-4" data-testid="gcash-payment">
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              {settings?.gcash_qr_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.gcash_qr_url} alt="GCash QR code" className="h-44 w-44 rounded-2xl bg-white p-2" />
              )}
              <div>
                <p className="text-sm text-coffee-700">Send your deposit by GCash</p>
                <p className="text-3xl font-bold tabular-nums" data-testid="gcash-amount">
                  {formatPeso(deposit)}
                </p>
                {settings?.gcash_name && <p className="mt-1 font-semibold">{settings.gcash_name}</p>}
                {settings?.gcash_number && <p className="font-mono text-lg">{settings.gcash_number}</p>}
              </div>
            </div>
            <div data-error={tried && !!errors.proof}>
              <span className="label">Payment screenshot</span>
              <FilePick file={proof} onFile={setProof} label="GCash payment screenshot" hint="Take a screenshot of the GCash receipt and attach it here." />
              {show("proof")}
            </div>
          </div>
        )}
      </section>

      {error && <Alert>{error}</Alert>}
      <div className="fixed inset-x-0 bottom-[var(--nav-h,0px)] z-20 border-t border-coffee-100 bg-cream/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur [.has-bottom-nav_&]:pb-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            {total > 0 && (
              <>
                <p className="font-bold tabular-nums">{formatPeso(total)}</p>
                <p className="text-coffee-700">Deposit {formatPeso(deposit)}</p>
              </>
            )}
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner /> : "Book this stay"}
          </button>
        </div>
      </div>
    </form>
  );
}

function FilePick({ file, onFile, label, hint }: { file: File | null; onFile: (f: File | null) => void; label: string; hint: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <label className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-coffee-300 bg-white px-4 py-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-14 w-14 rounded-lg object-cover" />
      ) : (
        <span aria-hidden className="text-3xl">
          📷
        </span>
      )}
      <span className="text-sm">
        <span className="block font-semibold">{file ? "Change photo" : "Add photo"}</span>
        <span className="text-coffee-700">{hint}</span>
      </span>
      <input type="file" accept="image/*" className="sr-only" aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}
