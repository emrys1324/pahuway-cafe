"use client";
import { useEffect, useMemo, useState } from "react";
import { Sheet, ItemPhoto, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/format";
import { useCart } from "@/lib/cart";
import type { MenuItem, OptionGroup, SelectedOption } from "@/lib/types";

export function QtyStepper({ value, onChange, min = 1, label }: { value: number; onChange: (n: number) => void; min?: number; label: string }) {
  return (
    <div className="flex items-center rounded-2xl border border-coffee-200 bg-white" role="group" aria-label={label}>
      <button type="button" className="h-12 w-12 text-2xl font-bold text-coffee-700 disabled:opacity-30" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease quantity">
        −
      </button>
      <span className="w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="h-12 w-12 text-2xl font-bold text-coffee-700 disabled:opacity-30" onClick={() => onChange(value + 1)} disabled={value >= 50} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}

export function ItemSheet({
  item,
  groups,
  canOrder,
  onClose,
  store,
}: {
  item: MenuItem | null;
  groups: Record<string, OptionGroup>;
  canOrder: boolean;
  onClose: () => void;
  /** the store this item is from; adding it to a cart from another store starts a new cart */
  store?: { slug: string; name: string };
}) {
  const { add, clear, store: cartStore } = useCart();
  const itemGroups = useMemo(
    () =>
      (item?.menu_item_option_groups ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => groups[g.group_id])
        .filter((g): g is OptionGroup => !!g && (g.item_options?.length ?? 0) > 0),
    [item, groups],
  );

  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!item) return;
    const init: Record<string, string[]> = {};
    for (const g of itemGroups) {
      const def = g.item_options!.filter((o) => o.is_default).map((o) => o.id);
      init[g.id] = g.selection === "single" ? def.slice(0, 1) : def;
    }
    setPicked(init);
    setQty(1);
    setNotes("");
    setShowErrors(false);
  }, [item, itemGroups]);

  if (!item) return null;

  const selected: SelectedOption[] = itemGroups.flatMap((g) =>
    g.item_options!.filter((o) => picked[g.id]?.includes(o.id)).map((o) => ({ id: o.id, group: g.name, name: o.name, price_delta: Number(o.price_delta) })),
  );
  const missing = itemGroups.filter((g) => g.is_required && !(picked[g.id]?.length));
  const unit = Number(item.price) + selected.reduce((s, o) => s + o.price_delta, 0);

  const toggle = (g: OptionGroup, id: string) => {
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (g.selection === "single") return { ...p, [g.id]: g.is_required ? [id] : cur[0] === id ? [] : [id] };
      if (cur.includes(id)) return { ...p, [g.id]: cur.filter((x) => x !== id) };
      if (g.max_select && cur.length >= g.max_select) return p;
      return { ...p, [g.id]: [...cur, id] };
    });
  };

  const submit = () => {
    if (missing.length) {
      setShowErrors(true);
      document.getElementById(`grp-${missing[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (cartStore && store && cartStore.slug !== store.slug) {
      if (!window.confirm(`Your cart has items from ${cartStore.name}. Start a new cart with ${store.name}? (One store per order.)`)) return;
      clear();
    }
    add({
      store_slug: store?.slug ?? "pahuway-cafe",
      store_name: store?.name ?? "Pahuway Cafe",
      menu_item_id: item.id,
      name: item.name,
      photo_url: item.photo_url,
      base_price: Number(item.price),
      options: selected,
      unit_price: unit,
      quantity: qty,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      footer={
        item.is_sold_out ? (
          <div className="text-center font-semibold text-coffee-700">Sorry, this item is sold out for today.</div>
        ) : !canOrder ? (
          <div className="text-center font-semibold text-coffee-700">We&apos;re closed right now — ordering opens during store hours.</div>
        ) : (
          <div className="flex items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} label={`Quantity of ${item.name}`} />
            <button className="btn-primary flex-1" onClick={submit}>
              Add · {formatPeso(unit * qty)}
            </button>
          </div>
        )
      }
    >
      <div className="relative">
        <ItemPhoto src={item.photo_url} alt={item.name} className="aspect-[16/10] w-full" />
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-2xl shadow">
          ×
        </button>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">{item.name}</h2>
            <span className="pt-1 text-lg font-bold">{formatPeso(item.price)}</span>
          </div>
          {item.is_sold_out && (
            <div className="mt-1">
              <Badge tone="red">Sold out</Badge>
            </div>
          )}
          {item.description && <p className="mt-1.5 text-coffee-700">{item.description}</p>}
        </div>

        {itemGroups.map((g) => {
          const err = showErrors && g.is_required && !(picked[g.id]?.length);
          return (
            <fieldset key={g.id} id={`grp-${g.id}`} className={`rounded-2xl ${err ? "ring-2 ring-red-300" : ""}`}>
              <legend className="mb-2 flex w-full items-center justify-between">
                <span className="text-base font-bold">{g.name}</span>
                <span className={`text-xs font-semibold ${err ? "text-red-700" : "text-coffee-600"}`}>
                  {g.is_required ? "Required" : g.selection === "multi" ? (g.max_select ? `Optional · up to ${g.max_select}` : "Optional") : "Optional"}
                </span>
              </legend>
              <div className={g.item_options!.length > 3 && g.selection === "single" ? "flex flex-wrap gap-2" : "space-y-2"}>
                {g.item_options!.map((o) => {
                  const on = picked[g.id]?.includes(o.id) ?? false;
                  const delta = Number(o.price_delta);
                  if (g.item_options!.length > 3 && g.selection === "single") {
                    return (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(g, o.id)}
                        className={`chip ${on ? "border-coffee-700 bg-coffee-700 text-cream" : "border-coffee-200 bg-white text-coffee-800"}`}
                      >
                        {o.name}
                        {delta !== 0 && ` +${formatPeso(delta)}`}
                      </button>
                    );
                  }
                  return (
                    <label
                      key={o.id}
                      className={`flex min-h-[52px] cursor-pointer items-center justify-between rounded-2xl border px-4 ${
                        on ? "border-coffee-600 bg-coffee-50" : "border-coffee-200 bg-white"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={g.selection === "single" ? "radio" : "checkbox"}
                          name={`${item.id}-${g.id}`}
                          checked={on}
                          onChange={() => toggle(g, o.id)}
                          onClick={(e) => {
                            // allow un-selecting an optional radio
                            if (g.selection === "single" && !g.is_required && on) {
                              e.preventDefault();
                              toggle(g, o.id);
                            }
                          }}
                          className="h-5 w-5 accent-coffee-700"
                        />
                        <span className="font-medium">{o.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-coffee-700">{delta ? `+${formatPeso(delta)}` : ""}</span>
                    </label>
                  );
                })}
              </div>
              {err && <p className="error-text">Please choose one.</p>}
            </fieldset>
          );
        })}

        <div>
          <label className="label" htmlFor="item-notes">
            Notes for the barista <span className="font-normal text-coffee-600">(optional)</span>
          </label>
          <input
            id="item-notes"
            className="input"
            maxLength={200}
            placeholder="e.g. less ice, extra hot"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Sheet>
  );
}
