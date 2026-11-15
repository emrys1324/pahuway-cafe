"use client";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { Alert, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { friendlyError, normalizePhone } from "@/lib/format";
import { isPhoneLoginEmail } from "@/lib/phone-login";
import { useStoreSettings } from "@/lib/store-settings";

const IDEAS: { name: string; emoji: string; text: string }[] = [
  { name: "Island hopping", emoji: "🏝️", text: "Cobrador, Bonbon, Carabao — boat, guide and snorkel gear" },
  { name: "Snorkeling & diving", emoji: "🤿", text: "Reefs around Looc Bay and Tablas" },
  { name: "Waterfalls & hikes", emoji: "⛰️", text: "Cantingas River, Mt. Guiting-Guiting with licensed guides" },
  { name: "Beaches & sunsets", emoji: "🌅", text: "Quiet coves and the best sunset spots" },
  { name: "Food & culture", emoji: "🍲", text: "Marble workshops, heritage towns and local kitchens" },
  { name: "Motorbike tours", emoji: "🛵", text: "Self-guided island loops — pair with a Baybayin rental" },
];

/** Tours are coming soon: what's planned, and a "Notify me" sign-up (one per mobile number). */
export function ToursScreen() {
  const { settings, open } = useStoreSettings();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "new" | "updated">(null);
  const [already, setAlready] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    const db = getSupabase();
    db.rpc("tour_signup_count").then(({ data }) => setWaiting(typeof data === "number" ? data : null));
    (async () => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return;
      const { data: p } = await db.from("users").select("full_name, phone").eq("id", auth.user.id).single();
      if (p?.full_name) setName((v) => v || p.full_name);
      if (p?.phone) setPhone((v) => v || p.phone);
      const em = auth.user.email;
      if (em && !isPhoneLoginEmail(em)) setEmail((v) => v || em);
      const { data: mine } = await db.from("tour_signups").select("interests, group_size, notes").eq("user_id", auth.user.id).limit(1);
      if (mine?.[0]) {
        setAlready(true);
        setPicked(mine[0].interests ?? []);
        if (mine[0].group_size) setSize(String(mine[0].group_size));
        if (mine[0].notes) setNotes(mine[0].notes);
      }
    })();
  }, []);

  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (!normalizePhone(phone)) return setError("Use the format 09XXXXXXXXX for your mobile number.");
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Please check your email.");
    setBusy(true);
    const { data, error } = await getSupabase().rpc("tour_notify", {
      p: { name: name.trim(), phone: normalizePhone(phone), email: email.trim() || null, interests: picked, group_size: size || null, notes },
    });
    setBusy(false);
    if (error) return setError(friendlyError(error.message));
    setDone(data?.new ? "new" : "updated");
    setAlready(true);
    if (data?.new) setWaiting((w) => (w == null ? w : w + 1));
  };

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" back="/" />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 to-orange-800 p-6 text-white shadow-lg" data-testid="tours-hero">
          <svg aria-hidden viewBox="0 0 1200 150" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 -z-10 h-16 w-full opacity-30">
            <path d="M0 100 Q200 78 400 98 T800 92 T1200 96 V150 H0Z" fill="#fff" />
          </svg>
          <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-bold">🚤 Coming soon</span>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight">Island tours & activities</h1>
          <p className="mt-1 text-white/90">Book trusted local guides and boat operators across Romblon — right here in Padaya. Tell us what you'd like to do and we'll message you the day tours open.</p>
          {waiting != null && waiting > 0 && (
            <p className="mt-3 text-sm font-semibold" data-testid="tours-waiting">
              {waiting} {waiting === 1 ? "person is" : "people are"} already on the list
            </p>
          )}
        </section>

        <section aria-labelledby="ideas-title">
          <h2 id="ideas-title" className="section-title mb-3">
            What's coming
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {IDEAS.map((i) => (
              <li key={i.name} className="card flex items-center gap-3 p-4">
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-2xl">
                  {i.emoji}
                </span>
                <span>
                  <span className="block font-bold">{i.name}</span>
                  <span className="block text-sm text-coffee-700">{i.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <form onSubmit={submit} noValidate className="card space-y-4 p-5" data-testid="notify-form">
          <div>
            <h2 className="section-title">Notify me when tours open</h2>
            <p className="text-sm text-coffee-700">{already ? "You're on the list ✓ — change your picks below anytime." : "One message when tours open. No spam."}</p>
          </div>
          {done && (
            <Alert tone="green">
              <span data-testid="notify-done">{done === "new" ? "You're on the list! We'll message you as soon as tours open." : "Saved — your picks are updated."}</span>
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          <fieldset>
            <legend className="label">What would you like to do? (optional)</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tour ideas">
              {IDEAS.map((i) => {
                const on = picked.includes(i.name);
                return (
                  <button key={i.name} type="button" aria-pressed={on} onClick={() => toggle(i.name)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-orange-700 text-white" : "border border-coffee-200 bg-white text-coffee-800"}`}>
                    {i.emoji} {i.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Name</span>
              <input className="input" id="tour-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label className="block">
              <span className="label">Mobile number</span>
              <input className="input" id="tour-phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Email (optional)</span>
              <input className="input" id="tour-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Group size (optional)</span>
              <input className="input" id="tour-size" type="number" min={1} max={50} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Anything else? (optional)</span>
            <input className="input" id="tour-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. We're visiting in March" />
          </label>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : already ? "Update my picks" : "Notify me"}
          </button>
        </form>
      </main>
    </div>
  );
}
