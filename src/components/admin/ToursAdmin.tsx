"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/hours";

interface Signup {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  interests: string[];
  group_size: number | null;
  notes: string | null;
  created_at: string;
  notified_at: string | null;
}

/** Tours are coming soon: everyone who tapped "Notify me", what they'd like to do, and a copy-all list of numbers. */
export function ToursAdmin() {
  const [list, setList] = useState<Signup[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from("tour_signups").select("*").order("created_at", { ascending: false });
    setList((data as Signup[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!list) return <PageLoader />;
  const tally = Object.entries(list.flatMap((s) => s.interests).reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  const waiting = list.filter((s) => !s.notified_at);
  const copy = async () => {
    await navigator.clipboard.writeText(waiting.map((s) => s.phone).join(", ")).catch(() => null);
    setMsg(`Copied ${waiting.length} mobile number${waiting.length === 1 ? "" : "s"}.`);
  };
  const markNotified = async () => {
    setBusy(true);
    const { error } = await getSupabase().from("tour_signups").update({ notified_at: new Date().toISOString() }).is("notified_at", null);
    setBusy(false);
    setMsg(error ? error.message : "Marked everyone as told.");
    load();
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Tours — Notify me list</h1>
        <p className="text-coffee-700">Tours show as “coming soon”. Customers who want a message when they open are listed here.</p>
      </div>
      {msg && <Alert tone="green">{msg}</Alert>}
      <section className="card flex flex-wrap items-center gap-3 p-4" data-testid="tours-summary">
        <p className="flex-1 font-semibold">
          {list.length} sign-up{list.length === 1 ? "" : "s"} · {waiting.length} not told yet
        </p>
        <button className="btn-secondary btn-sm" onClick={copy} disabled={!waiting.length}>
          Copy mobile numbers
        </button>
        <button className="btn-secondary btn-sm" onClick={markNotified} disabled={!waiting.length || busy}>
          {busy ? <Spinner /> : "Mark all as told"}
        </button>
      </section>
      {tally.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Most wanted" data-testid="tours-tally">
          {tally.map(([k, n]) => (
            <li key={k} className="rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800 ring-1 ring-orange-200">
              {k} · {n}
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 ? (
        <p className="card p-6 text-center text-coffee-700">No sign-ups yet. Share padaya.online/tours to start a list.</p>
      ) : (
        <ul className="grid gap-2">
          {list.map((s) => (
            <li key={s.id} className="card p-4" data-testid="tour-signup">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{s.name}</span>
                <a href={`tel:${s.phone}`} className="font-semibold text-orange-700 underline">
                  {s.phone}
                </a>
                {s.email && <span className="text-sm text-coffee-700">{s.email}</span>}
                {s.group_size && <span className="text-sm text-coffee-700">· group of {s.group_size}</span>}
                <span className="ml-auto">{s.notified_at ? <Badge tone="green">Told</Badge> : <Badge tone="amber">Waiting</Badge>}</span>
              </div>
              {s.interests.length > 0 && <p className="mt-1 text-sm">{s.interests.join(" · ")}</p>}
              {s.notes && <p className="mt-1 text-sm text-coffee-700">“{s.notes}”</p>}
              <p className="mt-1 text-xs text-coffee-500">{formatDateTime(s.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
