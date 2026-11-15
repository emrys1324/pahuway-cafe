"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, PageLoader, Sheet, Spinner, Toggle } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { uploadPublicImage } from "@/lib/upload";
import { useStoreSettings } from "@/lib/store-settings";
import { TOWNS } from "@/lib/romblon";
import { MAIN_STORE, storeHours, storeOpenNow, type Store } from "@/lib/stores";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Food stores: each has its own menu (Menu page → pick the store), hours, open switch and town. */
export function StoresAdmin() {
  const { settings } = useStoreSettings();
  const [list, setList] = useState<Store[] | null>(null);
  const [edit, setEdit] = useState<Partial<Store> | null>(null);
  const load = async () => {
    const { data } = await getSupabase().from("businesses").select("*").eq("kind", "food").order("sort_order").order("name");
    setList((data as Store[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);
  if (!list) return <PageLoader />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Food stores</h1>
          <p className="text-coffee-700">Each store has its own menu, hours and open switch. Customers order from one store at a time.</p>
        </div>
        <button className="btn-primary" onClick={() => setEdit({ is_active: false, is_open: true, emoji: "🍽️", town: "San Agustin", open_time: "08:00", close_time: "20:00", prep_minutes: 25 })}>
          + Add store
        </button>
      </div>
      <ul className="grid gap-2">
        {list.map((s) => {
          const open = storeOpenNow(s, settings);
          return (
            <li key={s.id} className="card flex flex-wrap items-center gap-3 p-4" data-testid="admin-store">
              {s.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logo_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
              ) : (
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-2xl">
                  {s.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {s.name} {!s.is_active && <Badge tone="gray">Hidden</Badge>} {s.is_active && <Badge tone={open ? "green" : "amber"}>{open ? "Open now" : "Closed now"}</Badge>}
                </p>
                <p className="text-sm text-coffee-700">
                  {s.tagline ? `${s.tagline} · ` : ""}📍 {s.town} · {storeHours(s, settings)}
                </p>
              </div>
              <Link href={`/admin/menu?store=${s.id}`} className="btn-secondary btn-sm">
                Menu
              </Link>
              <button className="btn-secondary btn-sm" onClick={() => setEdit(s)}>
                Edit
              </button>
            </li>
          );
        })}
      </ul>
      <StoreSheet value={edit} onClose={() => setEdit(null)} onSaved={load} />
    </div>
  );
}

function StoreSheet({ value, onClose, onSaved }: { value: Partial<Store> | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Store>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    setV(value ?? {});
    setErr(null);
  }, [value]);
  const set = <K extends keyof Store>(k: K, x: Store[K]) => setV((o) => ({ ...o, [k]: x }));
  const isMain = v.slug === MAIN_STORE;
  const save = async () => {
    setErr(null);
    const name = (v.name ?? "").trim();
    if (name.length < 2) return setErr("Please enter the store name.");
    setBusy(true);
    const row = {
      name,
      tagline: v.tagline?.trim() || null,
      emoji: v.emoji?.trim() || "🍽️",
      town: v.town || "San Agustin",
      logo_url: v.logo_url || null,
      is_active: !!v.is_active,
      is_open: v.is_open !== false,
      open_time: (v.open_time ?? "08:00").slice(0, 5),
      close_time: (v.close_time ?? "20:00").slice(0, 5),
      prep_minutes: Math.min(180, Math.max(5, Number(v.prep_minutes) || 20)),
      sort_order: Number(v.sort_order ?? 0),
    };
    const db = getSupabase().from("businesses");
    const { error } = v.id ? await db.update(row).eq("id", v.id) : await db.insert({ ...row, kind: "food", slug: slugify(name) || `store-${Date.now()}` });
    setBusy(false);
    if (error) return setErr(/duplicate|unique/.test(error.message) ? "A store with that name already exists." : error.message);
    onSaved();
    onClose();
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={v.id ? `Edit ${v.name}` : "Add a food store"}>
      <div className="space-y-3" data-testid="store-form">
        {err && <Alert>{err}</Alert>}
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-bold">Show to customers</span>
            <span className="text-sm text-coffee-700">Hidden stores don&apos;t appear in Food delivery and can&apos;t take orders.</span>
          </span>
          <Toggle checked={!!v.is_active} onChange={(x) => set("is_active", x)} label="Show to customers" />
        </label>
        {!isMain && (
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-bold">Taking orders now</span>
              <span className="text-sm text-coffee-700">Switch off to close early (e.g. sold out for the day).</span>
            </span>
            <Toggle checked={v.is_open !== false} onChange={(x) => set("is_open", x)} label="Taking orders now" />
          </label>
        )}
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <label className="block">
            <span className="label">Store name</span>
            <input className="input" aria-label="Store name" value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={60} />
          </label>
          <label className="block">
            <span className="label">Icon</span>
            <input className="input text-center text-xl" aria-label="Icon" value={v.emoji ?? ""} onChange={(e) => set("emoji", e.target.value)} maxLength={4} />
          </label>
        </div>
        <label className="block">
          <span className="label">Short description</span>
          <input className="input" aria-label="Short description" value={v.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} maxLength={80} placeholder="Ramen, dimsum & more" />
        </label>
        <label className="block">
          <span className="label">Town</span>
          <select className="input" aria-label="Town" value={v.town ?? "San Agustin"} onChange={(e) => set("town", e.target.value)}>
            {TOWNS.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
        {isMain ? (
          <p className="rounded-2xl bg-cream-100 px-4 py-3 text-sm">Pahuway Cafe&apos;s hours, name and logo are set in <strong>Settings</strong>.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Opens</span>
              <input className="input" type="time" aria-label="Opens" value={(v.open_time ?? "08:00").slice(0, 5)} onChange={(e) => set("open_time", e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Closes</span>
              <input className="input" type="time" aria-label="Closes" value={(v.close_time ?? "20:00").slice(0, 5)} onChange={(e) => set("close_time", e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Prep (min)</span>
              <input className="input" type="number" aria-label="Prep minutes" value={String(v.prep_minutes ?? 20)} onChange={(e) => set("prep_minutes", e.target.value as never)} />
            </label>
          </div>
        )}
        {!isMain && (
          <div>
            <span className="label">Logo (optional)</span>
            <div className="flex items-center gap-3">
              {v.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.logo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-xl bg-orange-50 text-3xl">
                  {v.emoji}
                </span>
              )}
              <label className="btn-secondary btn-sm cursor-pointer">
                {uploading ? <Spinner /> : "Upload logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="Upload store logo"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setUploading(true);
                    try {
                      set("logo_url", await uploadPublicImage(f, "stores", { maxDim: 600 }));
                    } catch (x) {
                      setErr((x as Error).message);
                    }
                    setUploading(false);
                  }}
                />
              </label>
              {v.logo_url && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => set("logo_url", null)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
        <button className="btn-primary w-full" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : "Save store"}
        </button>
      </div>
    </Sheet>
  );
}
