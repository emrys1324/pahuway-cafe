"use client";
import Link from "next/link";
import { MapPicker } from "@/components/map/MapPicker";
import { StreetAutocomplete } from "@/components/map/StreetAutocomplete";
import { useAddressSync } from "@/components/map/useAddressSync";
import { toLatLng } from "@/lib/maps";
import { useCallback, useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { Alert, Badge, PageLoader, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { signOutAndGo } from "@/lib/native";
import { formatPeso, normalizePhone, ORDER_TYPE_LABEL, STATUS_LABEL } from "@/lib/format";
import { formatDateTime } from "@/lib/hours";
import { useStoreSettings } from "@/lib/store-settings";
import { accountTexts } from "@/lib/brands";
import { isPhoneLoginEmail, phoneLoginEmail } from "@/lib/phone-login";
import { safeNext } from "@/lib/google-signin";
import { GoogleButton } from "@/components/customer/GoogleButton";
import { useSearchParams } from "next/navigation";
import type { Order, Zone } from "@/lib/types";
import { BOOKING_STATUS_LABEL, type BookingStatus } from "@/lib/rentals";
import type { User } from "@supabase/supabase-js";

interface Profile {
  role: string;
  full_name: string | null;
  phone: string | null;
  zone_id: string | null;
  street: string | null;
  landmark: string | null;
  saved_lat: number | null;
  saved_lng: number | null;
}

export function AccountScreen() {
  const { settings, open } = useStoreSettings();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const params = useSearchParams();
  const next = params.get("next") ? safeNext(params.get("next")) : null;

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} back="/" brand="account" />
      <main className="mx-auto max-w-lg px-4 py-5">
        {user === undefined ? <PageLoader /> : user ? <Profile user={user} next={next} /> : <AuthForms next={next} initialMode={params.get("mode") === "signup" ? "signup" : "signin"} />}
      </main>
    </div>
  );
}

function AuthForms({ next, initialMode }: { next: string | null; initialMode: "signin" | "signup" }) {
  const { settings } = useStoreSettings();
  const at = accountTexts(settings);
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  if (forgot) return <ForgotPassword initial={email} onBack={() => setForgot(false)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const supabase = getSupabase();
    if (mode === "signup") {
      if (name.trim().length < 2) return setMsg({ tone: "red", text: "Please enter your name." });
      const p = normalizePhone(phone);
      if (!p) return setMsg({ tone: "red", text: "Mobile number must look like 09XXXXXXXXX." });
      if (password.length < 8) return setMsg({ tone: "red", text: "Password must be at least 8 characters." });
      const em = email.trim();
      if (em && !/^\S+@\S+\.\S+$/.test(em)) return setMsg({ tone: "red", text: "Please check your email address, or leave it empty." });
      setBusy(true);
      if (!em) {
        // no email: the account signs in with the mobile number
        const res = await fetch("/api/account/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), phone: p, password }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBusy(false);
          return setMsg({ tone: "red", text: j.error ?? "We couldn't create your account. Please try again." });
        }
        const { error } = await supabase.auth.signInWithPassword({ email: phoneLoginEmail(p), password });
        setBusy(false);
        if (error) setMsg({ tone: "green", text: `Account created! Sign in with your mobile number ${p} and your password.` });
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: em,
        password,
        options: { data: { full_name: name.trim(), phone: p }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? "/account")}` },
      });
      setBusy(false);
      if (error) return setMsg({ tone: "red", text: error.message });
      if (!data.session) setMsg({ tone: "green", text: "Almost done! Check your email to confirm your account, then sign in." });
    } else {
      const id = email.trim();
      const asPhone = !id.includes("@") ? normalizePhone(id) : null;
      if (!id.includes("@") && !asPhone) return setMsg({ tone: "red", text: "Enter your email, or your mobile number as 09XXXXXXXXX." });
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email: asPhone ? phoneLoginEmail(asPhone) : id, password });
      setBusy(false);
      if (error) setMsg({ tone: "red", text: error.message === "Invalid login credentials" ? (asPhone ? "Wrong mobile number or password." : "Wrong email or password.") : error.message });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">{mode === "signin" ? at.title : "Create an account"}</h1>
        {at.subtitle && <p className="text-coffee-700">{at.subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-coffee-100 p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`min-h-[44px] rounded-xl font-semibold ${mode === m ? "bg-white shadow" : "text-coffee-700"}`}>
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>
      {next && <Alert tone="amber">Please sign in or create an account to continue. We&apos;ll bring you right back.</Alert>}
      <GoogleButton next={next ?? "/account"} />
      <div className="flex items-center gap-3 text-sm text-coffee-600">
        <span className="h-px flex-1 bg-coffee-200" /> or with your {mode === "signin" ? "email or mobile number" : "mobile number"}{" "}
        <span className="h-px flex-1 bg-coffee-200" />
      </div>
      <form onSubmit={submit} className="card space-y-4 p-5">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {mode === "signup" && (
          <>
            <div>
              <label className="label" htmlFor="su-name">
                Name
              </label>
              <input id="su-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="su-phone">
                Mobile number
              </label>
              <input id="su-phone" className="input" type="tel" inputMode="numeric" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="a-email">
            {mode === "signup" ? (
              <>
                Email <span className="font-normal text-coffee-600">(optional)</span>
              </>
            ) : (
              "Email or mobile number"
            )}
          </label>
          <input
            id="a-email"
            type={mode === "signup" ? "email" : "text"}
            autoComplete={mode === "signup" ? "email" : "username"}
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={mode === "signup" ? "you@example.com" : "you@example.com or 09XXXXXXXXX"}
            required={mode === "signin"}
          />
          {mode === "signup" && <p className="hint">No email? Leave it empty — you&apos;ll sign in with your mobile number and password.</p>}
        </div>
        <div>
          <label className="label" htmlFor="a-pass">
            Password
          </label>
          <input id="a-pass" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner /> : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {mode === "signin" && (
          <button type="button" className="w-full text-center text-sm font-semibold text-coffee-700 underline underline-offset-2" onClick={() => setForgot(true)}>
            Forgot password?
          </button>
        )}
      </form>
      <p className="text-center text-sm text-coffee-600">
        Staff or rider?{" "}
        <Link href="/login" className="font-semibold underline">
          Sign in here
        </Link>
      </p>
    </div>
  );
}

/** "Forgot password?": email accounts get a reset link; mobile-number accounts are reset by the café. */
function ForgotPassword({ initial, onBack }: { initial: string; onBack: () => void }) {
  const { settings } = useStoreSettings();
  const [id, setId] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"email" | "phone" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = id.trim();
    if (!v.includes("@")) {
      if (!normalizePhone(v)) return setError("Enter your email, or your mobile number as 09XXXXXXXXX.");
      return setDone("phone");
    }
    if (!/^\S+@\S+\.\S+$/.test(v)) return setError("Please check your email address.");
    setBusy(true);
    const { error } = await getSupabase().auth.resetPasswordForEmail(v, { redirectTo: `${window.location.origin}/welcome?reset=1` });
    setBusy(false);
    if (error && /rate limit|too many/i.test(error.message)) return setError("Too many reset emails were sent just now. Please try again in an hour, or contact the café.");
    if (error) return setError("We couldn't send the reset email. Please try again.");
    setDone("email");
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Reset your password</h1>
        <p className="text-coffee-700">Enter the email or mobile number you sign in with.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-5" data-testid="forgot-password">
        {error && <Alert>{error}</Alert>}
        {done === "email" ? (
          <Alert tone="green">If an account uses that email, we&apos;ve sent a link to set a new password. Check your inbox (and spam folder) — the link works once.</Alert>
        ) : done === "phone" ? (
          <div className="space-y-2 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950" data-testid="phone-reset-help">
            <p className="font-semibold">Accounts without an email are reset by the café.</p>
            <p>Message or call us with your name and mobile number. Our staff will give you a temporary password — sign in with it, then change it in your account.</p>
            {settings?.contact_phone && (
              <a href={`tel:${settings.contact_phone}`} className="btn-secondary w-full">
                📞 Call or text {settings.contact_phone}
              </a>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="reset-id">
                Email or mobile number
              </label>
              <input id="reset-id" className="input" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="you@example.com or 09XXXXXXXXX" />
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner /> : "Reset password"}
            </button>
          </>
        )}
      </form>
      <button type="button" className="btn-ghost w-full" onClick={onBack}>
        ← Back to sign in
      </button>
    </div>
  );
}

/** Change password while signed in (e.g. after the café gave a temporary one). */
function ChangePassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) return setMsg({ tone: "red", text: "Use at least 8 characters." });
    if (pw !== pw2) return setMsg({ tone: "red", text: "The two passwords don't match." });
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ tone: "red", text: /different from the old/i.test(error.message) ? "Choose a password you haven't used before." : error.message });
    setPw("");
    setPw2("");
    setMsg({ tone: "green", text: "Password changed." });
  };
  return (
    <form onSubmit={save} className="card space-y-3 p-5" data-testid="change-password">
      <h2 className="section-title">Change password</h2>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cp-new">
            New password
          </label>
          <input id="cp-new" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8+ characters" />
        </div>
        <div>
          <label className="label" htmlFor="cp-again">
            Type it again
          </label>
          <input id="cp-again" type="password" autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
      </div>
      <button className="btn-secondary" disabled={busy}>
        {busy ? <Spinner /> : "Change password"}
      </button>
    </form>
  );
}

interface MyBooking {
  id: string;
  booking_number: string;
  public_token: string;
  pickup_at: string | null;
  start_date: string;
  scooter_name: string;
  status: BookingStatus;
}

function Profile({ user, next }: { user: User; next: string | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [p, z, o, b] = await Promise.all([
      supabase.from("users").select("role, full_name, phone, zone_id, street, landmark, saved_lat, saved_lng").eq("id", user.id).single(),
      supabase.from("delivery_zones").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("orders").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase
        .from("rental_bookings")
        .select("id, booking_number, public_token, pickup_at, start_date, scooter_name, status")
        .eq("customer_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setBookings((b.data as MyBooking[]) ?? []);
    // signed in to continue an order/booking and nothing is missing → go straight back
    if (next && normalizePhone((p.data as Profile | null)?.phone ?? "")) window.location.replace(next);
    setProfile((p.data as Profile) ?? { role: "customer", full_name: "", phone: "", zone_id: null, street: "", landmark: "", saved_lat: null, saved_lng: null });
    setZones((z.data as Zone[]) ?? []);
    setOrders((o.data as Order[]) ?? []);
  }, [user.id, next]);

  useEffect(() => {
    load();
  }, [load]);

  const put = (patch: Partial<Profile>) => setProfile((p) => (p ? { ...p, ...patch } : p));
  const sync = useAddressSync({
    zones,
    zoneId: profile?.zone_id ?? "",
    setZoneId: (v) => put({ zone_id: v }),
    street: profile?.street ?? "",
    setStreet: (v) => put({ street: v }),
    landmark: profile?.landmark ?? "",
    setLandmark: (v) => put({ landmark: v }),
    pin: toLatLng(profile?.saved_lat, profile?.saved_lng),
    setPin: (p) => put({ saved_lat: p?.lat ?? null, saved_lng: p?.lng ?? null }),
  });
  if (!profile) return <PageLoader />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const phone = profile.phone ? normalizePhone(profile.phone) : null;
    if (profile.phone && !phone) return setMsg({ tone: "red", text: "Mobile number must look like 09XXXXXXXXX." });
    setSaving(true);
    const { error } = await getSupabase()
      .from("users")
      .update({ full_name: profile.full_name, phone, zone_id: profile.zone_id || null, street: profile.street, landmark: profile.landmark, saved_lat: profile.saved_lat, saved_lng: profile.saved_lng })
      .eq("id", user.id);
    setSaving(false);
    setMsg(error ? { tone: "red", text: error.message } : { tone: "green", text: "Saved! We'll fill these in at checkout." });
  };

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setProfile({ ...profile, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Hi, {profile.full_name?.split(" ")[0] || "there"}!</h1>
          <p className="text-sm text-coffee-700">{isPhoneLoginEmail(user.email) ? `Signs in with ${user.email!.split("@")[0]}` : user.email}</p>
        </div>
        <button
          className="btn-secondary btn-sm"
          onClick={() => signOutAndGo("/")}
        >
          Sign out
        </button>
      </div>

      {next && (
        <div className="card space-y-3 p-5" data-testid="continue-next">
          {!normalizePhone(profile.phone ?? "") ? (
            <MissingPhone
              userId={user.id}
              onSaved={(phone) => {
                put({ phone });
                window.location.replace(next);
              }}
            />
          ) : (
            <>
              <p className="font-semibold">You&apos;re signed in.</p>
              <Link href={next} className="btn-primary w-full">
                Continue
              </Link>
            </>
          )}
        </div>
      )}

      {(profile.role === "admin" || profile.role === "staff") && (
        <Link href="/admin" className="btn-primary w-full">
          Go to staff dashboard
        </Link>
      )}
      {profile.role === "rider" && (
        <Link href="/rider" className="btn-primary w-full">
          Go to my deliveries
        </Link>
      )}

      <form onSubmit={save} className="card space-y-4 p-5">
        <h2 className="section-title">Saved details</h2>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <label className="label" htmlFor="p-name">
            Name
          </label>
          <input id="p-name" className="input" value={profile.full_name ?? ""} onChange={set("full_name")} />
        </div>
        <div>
          <label className="label" htmlFor="p-phone">
            Mobile number
          </label>
          <input id="p-phone" className="input" type="tel" inputMode="numeric" placeholder="09XXXXXXXXX" value={profile.phone ?? ""} onChange={set("phone")} />
        </div>
        <div>
          <label className="label" htmlFor="p-zone">
            Barangay
          </label>
          <select id="p-zone" className="input" value={profile.zone_id ?? ""} onChange={set("zone_id")}>
            <option value="">—</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-street">
            House no. / Street / Purok
          </label>
          <StreetAutocomplete id="p-street" value={profile.street ?? ""} onChange={(v) => put({ street: v })} onPick={sync.onSuggestion} enabled={sync.enabled} />
        </div>
        <div>
          <label className="label" htmlFor="p-landmark">
            Landmark
          </label>
          <input id="p-landmark" className="input" value={profile.landmark ?? ""} onChange={set("landmark")} />
        </div>
        <MapPicker value={toLatLng(profile.saved_lat, profile.saved_lng)} onChange={sync.onPinChange} center={sync.center} note={sync.note} />
        <button className="btn-primary w-full" disabled={saving}>
          {saving ? <Spinner /> : "Save"}
        </button>
      </form>

      <section className="card p-5">
        <h2 className="section-title mb-2">Order history</h2>
        {orders.length === 0 ? (
          <p className="text-coffee-700">No orders yet. Orders you place while signed in will show here.</p>
        ) : (
          <ul className="divide-y divide-coffee-100">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/order/${o.public_token}`} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-bold">{o.order_number}</p>
                    <p className="text-sm text-coffee-700">
                      {formatDateTime(o.created_at)} · {ORDER_TYPE_LABEL[o.order_type]}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatPeso(o.total)}</p>
                    <Badge tone={o.status === "cancelled" ? "red" : o.status === "completed" ? "green" : "amber"}>{STATUS_LABEL[o.status]}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5" data-testid="my-bookings">
        <h2 className="section-title mb-2">My scooter bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-coffee-700">No bookings yet. Scooters you book while signed in will show here.</p>
        ) : (
          <ul className="divide-y divide-coffee-100">
            {bookings.map((b) => (
              <li key={b.id}>
                <Link href={`/baybayin/booking/${b.public_token}`} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-bold">{b.booking_number}</p>
                    <p className="text-sm text-coffee-700">
                      {b.scooter_name} · pickup {b.pickup_at ? formatDateTime(b.pickup_at) : b.start_date}
                    </p>
                  </div>
                  <Badge tone={b.status === "cancelled" ? "red" : b.status === "returned" ? "green" : "amber"}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChangePassword />
      <DeleteAccount />
      <p className="text-center text-sm">
        <Link href="/privacy" className="text-coffee-700 underline">
          Privacy policy
        </Link>
      </p>
    </div>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    await supabase.auth.signOut();
    window.location.href = "/?account_deleted=1";
  };

  return (
    <section className="card p-5">
      {!open ? (
        <button className="btn-ghost btn-sm w-full text-red-700" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <div className="space-y-3">
          <h2 className="section-title text-red-800">Delete account</h2>
          <p className="text-sm text-coffee-700">
            This permanently deletes your login and saved details. Your past orders stay in the café&apos;s records but are no longer linked to you. This can&apos;t be
            undone.
          </p>
          {error && <Alert>{error}</Alert>}
          <label className="label" htmlFor="del-confirm">
            Type DELETE to confirm
          </label>
          <input id="del-confirm" className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn-danger" onClick={remove} disabled={busy || confirmText.trim().toUpperCase() !== "DELETE"}>
              {busy ? <Spinner /> : "Delete forever"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** After Google sign-in there's no mobile number yet; the café needs one to reach the customer. */
function MissingPhone({ userId, onSaved }: { userId: string; onSaved: (phone: string) => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (!p) return setError("Mobile number must look like 09XXXXXXXXX.");
    setBusy(true);
    const { error } = await getSupabase().from("users").update({ phone: p }).eq("id", userId);
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(p);
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <p className="font-semibold">One more thing: your mobile number</p>
      <p className="text-sm text-coffee-700">We&apos;ll use it to reach you about your order or booking.</p>
      {error && <Alert>{error}</Alert>}
      <input aria-label="Mobile number" className="input" type="tel" inputMode="numeric" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : "Save and continue"}
      </button>
    </form>
  );
}
