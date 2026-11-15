"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, ItemPhoto, PageLoader, Sheet, Spinner, Toggle } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatPeso } from "@/lib/format";
import { deletePublicImage, uploadPublicImage } from "@/lib/upload";
import type { Category, MenuItem, OptionGroup } from "@/lib/types";
import { MAIN_STORE, useStores } from "@/lib/stores";

type Draft = Partial<MenuItem> & { groupIds: string[] };

export function MenuAdmin() {
  const stores = useStores(true);
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    if (!stores || storeId) return;
    const want = new URLSearchParams(window.location.search).get("store");
    setStoreId(stores.find((x) => x.id === want)?.id ?? stores.find((x) => x.slug === MAIN_STORE)?.id ?? stores[0]?.id ?? null);
  }, [stores, storeId]);
  const [allCats, setCats] = useState<Category[] | null>(null);
  const [allItems, setItems] = useState<MenuItem[]>([]);
  const cats = allCats && storeId ? allCats.filter((c) => (c.business_id ?? null) === storeId) : allCats;
  const items = storeId ? allItems.filter((i) => (i.business_id ?? null) === storeId) : allItems;
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");

  const load = useCallback(async () => {
    const s = getSupabase();
    const [c, i, g] = await Promise.all([
      s.from("menu_categories").select("*").order("sort_order"),
      s.from("menu_items").select("*, menu_item_option_groups(group_id, sort_order)").order("sort_order"),
      s.from("option_groups").select("*").order("sort_order"),
    ]);
    if (c.error || i.error || g.error) return setError((c.error || i.error || g.error)!.message);
    setCats(c.data as Category[]);
    setItems(i.data as MenuItem[]);
    setGroups(g.data as OptionGroup[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!cats || !stores) return error ? <Alert>{error}</Alert> : <PageLoader />;

  const patchItem = async (id: string, patch: Partial<MenuItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))); // optimistic
    const { error } = await getSupabase().from("menu_items").update(patch).eq("id", id);
    if (error) {
      setError(error.message);
      load();
    }
  };

  const patchCat = async (id: string, patch: Partial<Category>) => {
    setCats((prev) => prev!.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await getSupabase().from("menu_categories").update(patch).eq("id", id);
    if (error) setError(error.message);
  };

  const addCat = async () => {
    if (!newCat.trim()) return;
    const { error } = await getSupabase()
      .from("menu_categories")
      .insert({ name: newCat.trim(), sort_order: (cats.at(-1)?.sort_order ?? 0) + 1, business_id: storeId });
    if (error) return setError(error.message);
    setNewCat("");
    load();
  };

  const deleteCat = async (c: Category) => {
    if (items.some((i) => i.category_id === c.id)) return setError(`Move or delete the items in "${c.name}" first.`);
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const { error } = await getSupabase().from("menu_categories").delete().eq("id", c.id);
    if (error) return setError(error.message);
    load();
  };

  const shown = items.filter((i) => filter === "all" || (filter === "no-photo" ? !i.photo_url : i.category_id === filter));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold">Menu</h1>
          {stores.length > 1 && (
            <select
              aria-label="Store"
              data-testid="menu-store"
              className="input !w-auto !py-1.5"
              value={storeId ?? ""}
              onChange={(e) => {
                setStoreId(e.target.value);
                setFilter("all");
              }}
            >
              {stores.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.emoji} {st.name}
                  {st.is_active ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={() => setEditing({ category_id: filter !== "all" && filter !== "no-photo" ? filter : cats[0]?.id, price: 0, is_active: true, is_sold_out: false, groupIds: [] })}
          disabled={cats.length === 0}
        >
          + Add item
        </button>
      </div>
      {error && (
        <div onClick={() => setError(null)}>
          <Alert>{error} (tap to dismiss)</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card p-3 sm:p-4">
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
            {[{ id: "all", name: "All" }, { id: "no-photo", name: `No photo (${items.filter((x) => !x.photo_url).length})` }, ...cats].map((c) => (
              <button key={c.id} onClick={() => setFilter(c.id)} className={`chip ${filter === c.id ? "border-coffee-800 bg-coffee-800 text-cream" : "border-coffee-200 bg-white"}`}>
                {c.name}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-coffee-100">
            {shown.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3">
                <PhotoButton item={i} onSaved={(url) => setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, photo_url: url } : x)))} onError={setError} />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditing({ ...i, groupIds: (i.menu_item_option_groups ?? []).map((g) => g.group_id) })}
                >
                  <p className="truncate font-bold">{i.name}</p>
                  <p className="text-sm text-coffee-700">
                    {formatPeso(i.price)} · {cats.find((c) => c.id === i.category_id)?.name}
                  </p>
                  <div className="mt-0.5 flex gap-1">
                    {!i.is_active && <Badge tone="gray">Hidden</Badge>}
                    {i.is_sold_out && <Badge tone="red">Sold out</Badge>}
                  </div>
                </button>
                <label className="flex flex-col items-center gap-1 text-xs font-semibold text-coffee-700">
                  <Toggle checked={i.is_sold_out} onChange={(v) => patchItem(i.id, { is_sold_out: v })} label={`${i.name} sold out`} tone="red" />
                  Sold out
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="py-8 text-center text-coffee-600">No items yet.</li>}
          </ul>
        </section>

        <section className="card h-fit p-4">
          <h2 className="section-title mb-2">Categories</h2>
          <ul className="space-y-2">
            {cats.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <input
                  aria-label="Order"
                  type="number"
                  className="input w-16 px-2 text-center"
                  defaultValue={c.sort_order}
                  onBlur={(e) => Number(e.target.value) !== c.sort_order && patchCat(c.id, { sort_order: Number(e.target.value) })}
                />
                <input
                  aria-label="Category name"
                  className="input flex-1"
                  defaultValue={c.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patchCat(c.id, { name: e.target.value.trim() })}
                />
                <Toggle checked={c.is_active} onChange={(v) => patchCat(c.id, { is_active: v })} label={`Show ${c.name}`} />
                <button className="btn-ghost btn-sm text-red-700" onClick={() => deleteCat(c)} aria-label={`Delete ${c.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
            <button className="btn-secondary" onClick={addCat}>
              Add
            </button>
          </div>
          <p className="hint">Lower numbers show first. The switch hides a category from customers.</p>
        </section>
      </div>

      {editing && <ItemEditor draft={editing} cats={cats} groups={groups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ItemEditor({ draft, cats, groups, onClose, onSaved }: { draft: Draft; cats: Category[]; groups: OptionGroup[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  // a photo uploaded in this editor but not (yet) saved
  const unsavedUpload = d.photo_url && d.photo_url !== draft.photo_url ? d.photo_url : null;
  const close = async () => {
    await deletePublicImage(unsavedUpload); // closed without saving → don't leave the upload behind
    onClose();
  };

  const save = async () => {
    if (!d.name?.trim()) return setError("Name is required.");
    if (!(Number(d.price) >= 0)) return setError("Price must be 0 or more.");
    setBusy(true);
    setError(null);
    const s = getSupabase();
    const row = {
      name: d.name.trim(),
      category_id: d.category_id,
      price: Number(d.price),
      description: d.description?.trim() || null,
      photo_url: d.photo_url || null,
      is_active: d.is_active ?? true,
      is_sold_out: d.is_sold_out ?? false,
      sort_order: d.sort_order ?? 0,
    };
    const res = d.id ? await s.from("menu_items").update(row).eq("id", d.id).select("id").single() : await s.from("menu_items").insert(row).select("id").single();
    if (res.error) {
      setBusy(false);
      return setError(res.error.message);
    }
    const id = res.data.id;
    if (draft.photo_url && draft.photo_url !== row.photo_url) await deletePublicImage(draft.photo_url);
    await s.from("menu_item_option_groups").delete().eq("item_id", id);
    if (d.groupIds.length) {
      const { error } = await s.from("menu_item_option_groups").insert(
        d.groupIds.map((g) => ({ item_id: id, group_id: g, sort_order: groups.find((x) => x.id === g)?.sort_order ?? 0 })),
      );
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    onSaved();
  };

  const remove = async () => {
    if (!d.id || !confirm(`Delete "${d.name}"? Past orders keep their record. Tip: use "Visible on menu" to hide it instead.`)) return;
    setBusy(true);
    const { error } = await getSupabase().from("menu_items").delete().eq("id", d.id);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    await deletePublicImage(draft.photo_url);
    onSaved();
  };

  return (
    <Sheet
      open
      onClose={close}
      title={d.id ? "Edit item" : "New item"}
      footer={
        <div className="flex gap-2">
          {d.id && (
            <button className="btn-secondary text-red-700" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <button className="btn-primary flex-1" onClick={save} disabled={busy || uploading}>
            {busy ? <Spinner /> : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error && <Alert>{error}</Alert>}
        <div className="flex items-center gap-3">
          <ItemPhoto src={d.photo_url ?? null} alt="" className="h-24 w-24 shrink-0 rounded-2xl" />
          <div className="flex flex-col items-start gap-2">
          <label className="btn-secondary btn-sm cursor-pointer">
            {uploading ? <Spinner /> : d.photo_url ? "Change photo" : "Add photo"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const url = await uploadPublicImage(f, "items");
                  await deletePublicImage(unsavedUpload); // replaced an upload that was never saved
                  set("photo_url", url);
                } catch (err) {
                  setError((err as Error).message);
                }
                setUploading(false);
                e.target.value = "";
              }}
            />
          </label>
          {d.photo_url && (
            <button
              type="button"
              className="btn-ghost btn-sm text-red-700"
              disabled={uploading}
              onClick={async () => {
                if (!confirm("Remove this photo? Customers will see a plain placeholder until you add a new one.")) return;
                await deletePublicImage(unsavedUpload);
                set("photo_url", null);
              }}
            >
              Remove photo
            </button>
          )}
          <p className="text-xs text-coffee-600">Square photos look best. Big phone photos are shrunk automatically.</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="i-name">
            Name
          </label>
          <input id="i-name" className="input" value={d.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="i-price">
              Price (₱)
            </label>
            <input id="i-price" className="input" type="number" inputMode="decimal" min={0} step="1" value={d.price ?? ""} onChange={(e) => set("price", e.target.value as unknown as number)} />
          </div>
          <div>
            <label className="label" htmlFor="i-cat">
              Category
            </label>
            <select id="i-cat" className="input" value={d.category_id ?? ""} onChange={(e) => set("category_id", e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="i-desc">
            Description
          </label>
          <textarea id="i-desc" className="input min-h-[88px] py-3" value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={240} />
        </div>
        <fieldset>
          <legend className="label">Options customers can choose</legend>
          <div className="grid grid-cols-2 gap-2">
            {groups.map((g) => (
              <label key={g.id} className="flex min-h-[48px] items-center gap-2 rounded-2xl border border-coffee-200 bg-white px-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-coffee-700"
                  checked={d.groupIds.includes(g.id)}
                  onChange={(e) => set("groupIds", e.target.checked ? [...d.groupIds, g.id] : d.groupIds.filter((x) => x !== g.id))}
                />
                <span className="text-sm font-medium">{g.name}</span>
              </label>
            ))}
          </div>
          <p className="hint">Edit option choices and prices on the Options page.</p>
        </fieldset>
        <div className="space-y-3 rounded-2xl bg-white p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="font-semibold">Visible on menu</span>
            <Toggle checked={d.is_active ?? true} onChange={(v) => set("is_active", v)} label="Visible on menu" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="font-semibold">Sold out</span>
            <Toggle checked={d.is_sold_out ?? false} onChange={(v) => set("is_sold_out", v)} label="Sold out" tone="red" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="font-semibold">Display order</span>
            <input type="number" className="input w-24 text-center" value={d.sort_order ?? 0} onChange={(e) => set("sort_order", Number(e.target.value))} aria-label="Display order" />
          </label>
        </div>
      </div>
    </Sheet>
  );
}

/** Thumbnail in the menu list: tap to add or change the photo — uploads and saves immediately. */
function PhotoButton({ item, onSaved, onError }: { item: MenuItem; onSaved: (url: string) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadPublicImage(file, "items");
      const { error } = await getSupabase().from("menu_items").update({ photo_url: url }).eq("id", item.id);
      if (error) {
        await deletePublicImage(url);
        throw new Error(error.message);
      }
      await deletePublicImage(item.photo_url); // replaced → remove the old file
      onSaved(url);
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <label
      className="relative block h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl focus-within:ring-2 focus-within:ring-coffee-500"
      title={item.photo_url ? "Change photo" : "Add photo"}
    >
      {item.photo_url ? (
        <>
          <ItemPhoto src={item.photo_url} alt="" className="h-full w-full" />
          <span className="absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[11px] shadow" aria-hidden>
            📷
          </span>
        </>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-coffee-300 bg-coffee-50 text-[11px] font-semibold leading-tight text-coffee-700">
          <span className="text-base" aria-hidden>
            +
          </span>
          Photo
        </span>
      )}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-white/70">
          <Spinner className="h-5 w-5 text-coffee-700" />
        </span>
      )}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={`${item.photo_url ? "Change" : "Add"} photo for ${item.name}`}
        disabled={busy}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
