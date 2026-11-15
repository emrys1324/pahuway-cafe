"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, PageLoader, Sheet, Spinner, Toggle } from "@/components/ui";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { uploadPublicImage } from "@/lib/upload";
import { manilaDate } from "@/lib/rentals";
import { prettyYmd, STAY_STATUS_LABEL, type StayProperty, type StayRoom, type StaySettings, type StayStatus } from "@/lib/stays";

interface StayBooking {
  id: string;
  booking_number: string;
  room_id: string;
  room_name: string;
  property_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  total: number;
  deposit_amount: number;
  id_photo_path: string;
  payment_proof_path: string | null;
  notes: string | null;
  status: StayStatus;
  payment_status: "for_verification" | "deposit_paid" | "paid" | "refunded";
  cancel_reason: string | null;
  created_at: string;
}
type Tab = "bookings" | "rooms" | "settings";
const PAY_LABEL = { for_verification: "GCash to check", deposit_paid: "Deposit paid", paid: "Paid in full", refunded: "Refunded" } as const;
const CANCEL_REASONS = ["GCash deposit not received", "Guest cancelled", "Room not available", "No-show", "Couldn't verify ID"];

/** Padaya Stays for staff: bookings (verify deposit, check in/out, cancel, refund), properties & rooms, settings. */
export function StaysAdmin() {
  const [tab, setTab] = useState<Tab>("bookings");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Padaya Stays</h1>
        <div role="tablist" aria-label="Stays" className="flex gap-1 rounded-2xl bg-white p-1 shadow-card">
          {(["bookings", "rooms", "settings"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize ${tab === t ? "bg-coffee-800 text-cream" : "text-coffee-700"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === "bookings" && <BookingsTab />}
      {tab === "rooms" && <RoomsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- bookings
function BookingsTab() {
  const [list, setList] = useState<StayBooking[] | null>(null);
  const [filter, setFilter] = useState<"upcoming" | "check" | "done" | "all">("upcoming");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from("stay_bookings").select("*").order("check_in").order("created_at");
    setList((data as StayBooking[]) ?? []);
  }, []);
  useEffect(() => {
    load();
    let ch: ReturnType<ReturnType<typeof getSupabase>["channel"]> | null = null;
    getAuthedSupabase().then((db) => {
      ch = db.channel("stay-bookings-staff").on("postgres_changes", { event: "*", schema: "public", table: "stay_bookings" }, () => load()).subscribe();
    });
    return () => {
      if (ch) getSupabase().removeChannel(ch);
    };
  }, [load]);
  const toCheck = (list ?? []).filter((b) => b.status === "awaiting_deposit").length;
  useEffect(() => {
    if (toCheck) setFilter((f) => (f === "upcoming" ? "check" : f));
  }, [list === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(
    () =>
      (list ?? []).filter((b) =>
        filter === "all" ? true : filter === "upcoming" ? ["confirmed", "checked_in"].includes(b.status) : filter === "check" ? b.status === "awaiting_deposit" : ["checked_out", "cancelled"].includes(b.status),
      ),
    [list, filter],
  );
  const today = manilaDate();
  if (!list) return <PageLoader />;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Show">
        {(
          [
            ["upcoming", "Confirmed & staying"],
            ["check", `Deposits to check${toCheck ? ` (${toCheck})` : ""}`],
            ["done", "Checked out & cancelled"],
            ["all", "All"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === k ? "bg-coffee-800 text-cream" : "bg-white text-coffee-800 shadow-card"}`}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="card p-6 text-center text-coffee-700">No stays here yet.</p>}
      <ul className="grid gap-2">
        {shown.map((b) => (
          <li key={b.id}>
            <button onClick={() => setOpenId(b.id)} className="card flex w-full flex-wrap items-center gap-3 p-4 text-left" data-testid="stay-row">
              <span className="font-mono font-bold">{b.booking_number}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {b.customer_name} · {b.room_name}
                </span>
                <span className="block text-sm text-coffee-700">
                  {prettyYmd(b.check_in)} → {prettyYmd(b.check_out)} · {b.nights} night{b.nights === 1 ? "" : "s"} · {b.guests} guest{b.guests === 1 ? "" : "s"}
                  {b.check_in === today && b.status === "confirmed" && <strong className="text-sage-700"> · arriving today</strong>}
                  {b.check_out === today && b.status === "checked_in" && <strong className="text-amber-800"> · leaving today</strong>}
                </span>
              </span>
              <Badge tone={b.status === "cancelled" ? "red" : b.status === "awaiting_deposit" ? "amber" : b.status === "checked_in" ? "blue" : "green"}>
                {b.status === "awaiting_deposit" ? "Deposit to check" : STAY_STATUS_LABEL[b.status]}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <StaySheet booking={list.find((b) => b.id === openId) ?? null} onClose={() => setOpenId(null)} onChanged={load} />
    </section>
  );
}

function StaySheet({ booking: b, onClose, onChanged }: { booking: StayBooking | null; onClose: () => void; onChanged: () => void }) {
  const [idUrl, setIdUrl] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setIdUrl(null);
    setProofUrl(null);
    setError(null);
    setCancelling(false);
    setReason("");
    if (!b) return;
    const db = getSupabase();
    db.storage.from("license-photos").createSignedUrl(b.id_photo_path, 600).then(({ data }) => setIdUrl(data?.signedUrl ?? null));
    if (b.payment_proof_path) db.storage.from("payment-proofs").createSignedUrl(b.payment_proof_path, 600).then(({ data }) => setProofUrl(data?.signedUrl ?? null));
  }, [b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, patch: Partial<StayBooking> & { cancelled_at?: string }) => {
    if (!b) return;
    setBusy(key);
    setError(null);
    const { error } = await getSupabase().from("stay_bookings").update(patch).eq("id", b.id);
    setBusy(null);
    if (error) return setError(error.message);
    setCancelling(false);
    onChanged();
  };
  const btn = (key: string, label: string, patch: Parameters<typeof act>[1], cls = "btn-primary") => (
    <button type="button" className={`${cls} w-full`} disabled={!!busy} onClick={() => act(key, patch)}>
      {busy === key ? <Spinner /> : label}
    </button>
  );

  return (
    <Sheet open={!!b} onClose={onClose} title={b ? `Stay ${b.booking_number}` : ""}>
      {b && (
        <div className="space-y-4 text-sm" data-testid="stay-sheet">
          {error && <Alert>{error}</Alert>}
          <p>
            <Badge tone={b.status === "cancelled" ? "red" : b.status === "awaiting_deposit" ? "amber" : "green"}>{STAY_STATUS_LABEL[b.status]}</Badge>{" "}
            <Badge tone={b.payment_status === "for_verification" ? "amber" : b.payment_status === "refunded" ? "gray" : "green"}>{PAY_LABEL[b.payment_status]}</Badge>
          </p>
          <div className="space-y-1">
            <p className="text-base font-bold">{b.customer_name}</p>
            <p>
              <a href={`tel:${b.customer_phone}`} className="font-semibold text-orange-700 underline">
                {b.customer_phone}
              </a>
              {b.customer_email && ` · ${b.customer_email}`}
            </p>
            <p>
              <strong>{b.room_name}</strong> · {b.property_name}
            </p>
            <p>
              {prettyYmd(b.check_in)} → {prettyYmd(b.check_out)} · {b.nights} night{b.nights === 1 ? "" : "s"} · {b.guests} guest{b.guests === 1 ? "" : "s"}
            </p>
            {b.notes && <p className="rounded-xl bg-cream-100 px-3 py-2">“{b.notes}”</p>}
          </div>
          <dl className="space-y-1 rounded-2xl bg-cream-100 p-3">
            <div className="flex justify-between font-bold">
              <dt>Total</dt>
              <dd>{formatPeso(b.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Deposit (GCash)</dt>
              <dd data-testid="sheet-deposit">{formatPeso(b.deposit_amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Collect at check-in</dt>
              <dd>{formatPeso(b.payment_status === "paid" ? 0 : Number(b.total) - Number(b.deposit_amount))}</dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-3">
            <figure>
              <figcaption className="label">Valid ID</figcaption>
              {idUrl ? (
                <a href={idUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={idUrl} alt="Guest ID" className="aspect-[4/3] w-full rounded-xl object-cover" data-testid="id-photo" />
                </a>
              ) : (
                <Spinner />
              )}
            </figure>
            <figure>
              <figcaption className="label">GCash receipt</figcaption>
              {proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proofUrl} alt="GCash receipt" className="aspect-[4/3] w-full rounded-xl object-cover" data-testid="proof-photo" />
                </a>
              ) : b.payment_proof_path ? (
                <Spinner />
              ) : (
                <p className="text-coffee-600">None</p>
              )}
            </figure>
          </div>

          <div className="space-y-2">
            {b.status === "awaiting_deposit" && btn("verify", `Deposit received (${formatPeso(b.deposit_amount)}) — confirm stay`, { status: "confirmed", payment_status: "deposit_paid" })}
            {b.status === "confirmed" && btn("in", "Guest checked in · balance paid", { status: "checked_in", payment_status: "paid" })}
            {b.status === "checked_in" && btn("out", "Guest checked out", { status: "checked_out" })}
            {b.status === "cancelled" && b.payment_status === "deposit_paid" && btn("refund", "Mark deposit refunded", { payment_status: "refunded" }, "btn-secondary")}
            {["awaiting_deposit", "confirmed"].includes(b.status) &&
              (cancelling ? (
                <div className="space-y-2 rounded-2xl border border-red-200 p-3">
                  <label className="label" htmlFor="stay-cancel-reason">
                    Reason (the guest sees this)
                  </label>
                  <select id="stay-cancel-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">Choose…</option>
                    {CANCEL_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-danger w-full"
                    disabled={!reason || !!busy}
                    onClick={() => act("cancel", { status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString() })}
                  >
                    {busy === "cancel" ? <Spinner /> : "Cancel this stay"}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-ghost w-full text-red-700" onClick={() => setCancelling(true)}>
                  Cancel stay…
                </button>
              ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- properties & rooms
type PropEdit = Partial<StayProperty>;
type RoomEdit = Partial<StayRoom>;
const listText = (a?: string[] | null) => (a ?? []).join(", ");
const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function RoomsTab() {
  const [props, setProps] = useState<(StayProperty & { stay_rooms: StayRoom[] })[] | null>(null);
  const [editProp, setEditProp] = useState<PropEdit | null>(null);
  const [editRoom, setEditRoom] = useState<RoomEdit | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from("stay_properties").select("*, stay_rooms(*)").order("sort_order").order("name");
    setProps(((data as (StayProperty & { stay_rooms: StayRoom[] })[]) ?? []).map((p) => ({ ...p, stay_rooms: [...p.stay_rooms].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) })));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!props) return <PageLoader />;
  return (
    <section className="space-y-4">
      <button className="btn-primary" onClick={() => setEditProp({ is_active: false, photos: [], amenities: [], check_in_time: "14:00", check_out_time: "11:00" })}>
        + Add property
      </button>
      {props.map((p) => (
        <div key={p.id} className="card space-y-3 p-4" data-testid="admin-property">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {p.name} {!p.is_active && <Badge tone="gray">Hidden</Badge>}
              </p>
              <p className="text-sm text-coffee-700">{p.location_text || "No location yet"}</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setEditProp(p)}>
              Edit property
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setEditRoom({ property_id: p.id, is_active: false, photos: [], amenities: [], max_guests: 2, units: 1, min_nights: 1 })}>
              + Add room
            </button>
          </div>
          <ul className="grid gap-2">
            {p.stay_rooms.map((r) => (
              <li key={r.id}>
                <button className="flex w-full items-center gap-3 rounded-2xl border border-coffee-100 p-3 text-left" onClick={() => setEditRoom(r)} data-testid="admin-room">
                  {r.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photos[0]} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-lg bg-coffee-100 text-2xl">
                      🛏️
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {r.name} {!r.is_active && <Badge tone="gray">Hidden</Badge>}
                    </span>
                    <span className="block text-sm text-coffee-700">
                      {formatPeso(r.nightly_rate)}/night{r.weekend_rate != null ? ` · Fri/Sat ${formatPeso(r.weekend_rate)}` : ""} · {r.max_guests} guests · {r.units} room{r.units > 1 ? "s" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {p.stay_rooms.length === 0 && <li className="text-sm text-coffee-600">No rooms yet.</li>}
          </ul>
        </div>
      ))}
      <PropertySheet value={editProp} onClose={() => setEditProp(null)} onSaved={load} />
      <RoomSheet value={editRoom} onClose={() => setEditRoom(null)} onSaved={load} />
    </section>
  );
}

function Photos({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <span className="label">Photos (first one is the cover)</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((u, i) => (
          <div key={u} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" className="h-20 w-24 rounded-lg object-cover" />
            <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(photos.filter((x) => x !== u))} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-white">
              ×
            </button>
          </div>
        ))}
        <label className="flex h-20 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-coffee-300 text-sm font-semibold">
          {busy ? <Spinner /> : "+ Photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Add photo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                onChange([...photos, await uploadPublicImage(f, "stays", { maxDim: 1600 })]);
              } catch (x) {
                setErr((x as Error).message);
              }
              setBusy(false);
            }}
          />
        </label>
      </div>
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}

function PropertySheet({ value, onClose, onSaved }: { value: PropEdit | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<PropEdit>({});
  const [amen, setAmen] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setV(value ?? {});
    setAmen(listText(value?.amenities));
    setErr(null);
  }, [value]);
  const set = <K extends keyof StayProperty>(k: K, x: StayProperty[K]) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setErr(null);
    const map = v.map_url?.trim() || null;
    if (map && !/^https:\/\//.test(map)) return setErr("The map link must start with https://");
    setBusy(true);
    const row = {
      name: v.name?.trim() ?? "",
      description: v.description?.trim() || null,
      location_text: v.location_text?.trim() || null,
      map_url: map,
      photos: v.photos ?? [],
      amenities: toList(amen),
      house_rules: v.house_rules?.trim() || null,
      check_in_time: (v.check_in_time ?? "14:00").slice(0, 5),
      check_out_time: (v.check_out_time ?? "11:00").slice(0, 5),
      is_active: !!v.is_active,
      sort_order: Number(v.sort_order ?? 0),
    };
    const db = getSupabase().from("stay_properties");
    const { error } = v.id ? await db.update(row).eq("id", v.id) : await db.insert(row);
    setBusy(false);
    if (error) return setErr(/name/.test(error.message) ? "Name must be 2–80 characters." : error.message);
    onSaved();
    onClose();
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={v.id ? "Edit property" : "Add property"}>
      <div className="space-y-3" data-testid="property-form">
        {err && <Alert>{err}</Alert>}
        <label className="flex items-center justify-between gap-3">
          <span className="font-bold">Show to customers</span>
          <Toggle checked={!!v.is_active} onChange={(x) => set("is_active", x)} label="Show property" />
        </label>
        <Field label="Name" value={v.name ?? ""} onChange={(x) => set("name", x)} />
        <Field label="Location" value={v.location_text ?? ""} onChange={(x) => set("location_text", x)} placeholder="Barangay, town" />
        <Field label="Google Maps link" value={v.map_url ?? ""} onChange={(x) => set("map_url", x)} placeholder="https://maps.app.goo.gl/…" />
        <Area label="Description" value={v.description ?? ""} onChange={(x) => set("description", x)} />
        <Field label="Amenities (comma-separated)" value={amen} onChange={setAmen} placeholder="Wi-Fi, Air-con, Parking" />
        <Area label="House rules" value={v.house_rules ?? ""} onChange={(x) => set("house_rules", x)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in from" type="time" value={(v.check_in_time ?? "14:00").slice(0, 5)} onChange={(x) => set("check_in_time", x)} />
          <Field label="Check-out by" type="time" value={(v.check_out_time ?? "11:00").slice(0, 5)} onChange={(x) => set("check_out_time", x)} />
        </div>
        <Photos photos={v.photos ?? []} onChange={(p) => set("photos", p)} />
        <button className="btn-primary w-full" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : "Save property"}
        </button>
      </div>
    </Sheet>
  );
}

function RoomSheet({ value, onClose, onSaved }: { value: RoomEdit | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setV(value ? { ...value, amenities: listText(value.amenities), weekend_rate: value.weekend_rate ?? "" } : {});
    setErr(null);
  }, [value]);
  const s = (k: string) => String(v[k] ?? "");
  const set = (k: string) => (x: unknown) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setErr(null);
    const rate = Number(v.nightly_rate);
    if (!(rate >= 0) || s("nightly_rate") === "") return setErr("Please enter the nightly rate.");
    setBusy(true);
    const row = {
      property_id: v.property_id as string,
      name: s("name").trim(),
      description: s("description").trim() || null,
      photos: (v.photos as string[]) ?? [],
      amenities: toList(s("amenities")),
      nightly_rate: rate,
      weekend_rate: s("weekend_rate").trim() === "" ? null : Number(v.weekend_rate),
      max_guests: Math.max(1, Number(v.max_guests) || 2),
      units: Math.max(1, Number(v.units) || 1),
      min_nights: Math.max(1, Number(v.min_nights) || 1),
      is_active: !!v.is_active,
      sort_order: Number(v.sort_order ?? 0),
    };
    const db = getSupabase().from("stay_rooms");
    const { error } = v.id ? await db.update(row).eq("id", v.id as string) : await db.insert(row);
    setBusy(false);
    if (error) return setErr(/name/.test(error.message) ? "Name must be 2–80 characters." : error.message);
    onSaved();
    onClose();
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={v.id ? "Edit room" : "Add room"}>
      <div className="space-y-3" data-testid="room-form">
        {err && <Alert>{err}</Alert>}
        <label className="flex items-center justify-between gap-3">
          <span className="font-bold">Show to customers</span>
          <Toggle checked={!!v.is_active} onChange={set("is_active")} label="Show room" />
        </label>
        <Field label="Room name" value={s("name")} onChange={set("name")} placeholder="Deluxe double" />
        <Area label="Description" value={s("description")} onChange={set("description")} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nightly rate (₱)" type="number" value={s("nightly_rate")} onChange={set("nightly_rate")} />
          <Field label="Fri & Sat rate (₱, optional)" type="number" value={s("weekend_rate")} onChange={set("weekend_rate")} />
          <Field label="Max guests" type="number" value={s("max_guests")} onChange={set("max_guests")} />
          <Field label="Rooms of this type" type="number" value={s("units")} onChange={set("units")} />
          <Field label="Minimum nights" type="number" value={s("min_nights")} onChange={set("min_nights")} />
        </div>
        <Field label="Room amenities (comma-separated)" value={s("amenities")} onChange={set("amenities")} placeholder="Queen bed, Balcony" />
        <Photos photos={(v.photos as string[]) ?? []} onChange={set("photos")} />
        <button className="btn-primary w-full" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : "Save room"}
        </button>
      </div>
    </Sheet>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}
function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea className="input min-h-[96px]" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

// ---------------------------------------------------------------- settings
function SettingsTab() {
  const [s, setS] = useState<StaySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  useEffect(() => {
    getSupabase().from("stay_settings").select("*").eq("id", 1).single().then(({ data }) => setS(data as StaySettings));
  }, []);
  if (!s) return <PageLoader />;
  const ready = !!s.terms?.trim();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await getSupabase()
      .from("stay_settings")
      .update({
        bookings_enabled: s.bookings_enabled && ready,
        terms: s.terms?.trim() || null,
        deposit_percent: Math.min(100, Math.max(1, Number(s.deposit_percent) || 30)),
        free_cancel_days: Math.min(60, Math.max(0, Number(s.free_cancel_days) || 0)),
        max_nights: Math.min(90, Math.max(1, Number(s.max_nights) || 30)),
      })
      .eq("id", 1);
    setBusy(false);
    setMsg(error ? { tone: "red", text: error.message } : { tone: "green", text: "Stay settings saved." });
  };
  return (
    <form onSubmit={save} className="card space-y-4 p-5" data-testid="stay-settings">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-bold">Accept stay bookings</span>
          <span className="text-sm text-coffee-700">Off = Stays shows &ldquo;Coming soon&rdquo;. On = guests can book visible rooms and send the deposit by GCash.</span>
        </span>
        <Toggle checked={s.bookings_enabled && ready} onChange={(v) => setS({ ...s, bookings_enabled: v })} disabled={!ready} label="Accept stay bookings" />
      </label>
      {!ready && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Write your house rules and cancellation policy below and save — bookings can&apos;t open without them.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Deposit (%)" type="number" value={String(s.deposit_percent)} onChange={(x) => setS({ ...s, deposit_percent: x as never })} />
        <Field label="Free cancellation (days before)" type="number" value={String(s.free_cancel_days)} onChange={(x) => setS({ ...s, free_cancel_days: x as never })} />
        <Field label="Longest stay (nights)" type="number" value={String(s.max_nights)} onChange={(x) => setS({ ...s, max_nights: x as never })} />
      </div>
      <Area label="House rules & cancellation policy (guests must agree)" value={s.terms ?? ""} onChange={(x) => setS({ ...s, terms: x })} />
      <button className="btn-primary" disabled={busy}>
        {busy ? <Spinner /> : "Save settings"}
      </button>
    </form>
  );
}
