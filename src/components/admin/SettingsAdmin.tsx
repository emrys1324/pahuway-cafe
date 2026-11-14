"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, PageLoader, Spinner, Toggle } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { uploadPublicImage, uploadSiteIcons } from "@/lib/upload";
import { brandOf, DEFAULTS, DEFAULT_LOGO, welcomeTexts, type Brand } from "@/lib/brands";
import { useStoreSettings } from "@/lib/store-settings";
import { BackgroundLayer } from "@/components/BrandBackground";
import { DEFAULT_STAFF_HEADER, headerTheme, isHex } from "@/lib/color";
import { HOME_CARD_DEFAULTS, HomeCard } from "@/components/customer/HomeCard";
import type { StoreSettings } from "@/lib/types";
import { TeamSection } from "./TeamAdmin";
import { CustomerPasswordReset } from "./CustomerPasswordReset";
import { useStaffAccess } from "./StaffAccess";

export function SettingsAdmin() {
  const { isAdmin } = useStaffAccess();
  const { setLocal } = useStoreSettings();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("store_settings")
      .select("*")
      .eq("id", 1)
      .single()
      .then(({ data, error }) => (error ? setMsg({ tone: "red", text: error.message }) : setS(data as StoreSettings)));
  }, []);

  if (!s) return msg ? <Alert>{msg.text}</Alert> : <PageLoader />;
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setS({ ...s, [k]: v });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = await getSupabase()
      .from("store_settings")
      .update({
        store_name: s.store_name.trim() || "Pahuway Cafe",
        staff_title: (s.staff_title ?? "").trim() || "Pahuway Staff",
        header_color: isHex(s.header_color) ? s.header_color : null,
        staff_header_color: isHex(s.staff_header_color) ? s.staff_header_color : null,
        is_open: s.is_open,
        open_time: s.open_time,
        close_time: s.close_time,
        min_delivery_order: Number(s.min_delivery_order) || 0,
        prep_minutes: Math.min(120, Math.max(5, Number(s.prep_minutes) || 15)),
        closed_message: s.closed_message,
        gcash_name: s.gcash_name,
        gcash_number: s.gcash_number,
        gcash_qr_url: s.gcash_qr_url,
        contact_phone: s.contact_phone || null,
        contact_email: s.contact_email || null,
        logo_url: s.logo_url || null,
        baybayin_logo_url: s.baybayin_logo_url || null,
        site_name: clean(s.site_name),
        site_tagline: clean(s.site_tagline),
        site_logo_url: s.site_logo_url || null,
        site_header_color: isHex(s.site_header_color) ? s.site_header_color : null,
        welcome_title: clean(s.welcome_title),
        welcome_subtitle: clean(s.welcome_subtitle),
        cafe_card_text: clean(s.cafe_card_text),
        baybayin_card_text: clean(s.baybayin_card_text),
        store_tagline: clean(s.store_tagline),
        baybayin_name: clean(s.baybayin_name),
        baybayin_tagline: clean(s.baybayin_tagline),
        baybayin_header_color: isHex(s.baybayin_header_color) ? s.baybayin_header_color : null,
        account_name: clean(s.account_name),
        account_tagline: clean(s.account_tagline),
        account_logo_url: s.account_logo_url || null,
        account_header_color: isHex(s.account_header_color) ? s.account_header_color : null,
        account_title: clean(s.account_title),
        account_subtitle: clean(s.account_subtitle),
        site_icons: s.site_icons ?? null,
        background_url: s.background_url || null,
        background_fade: Math.min(95, Math.max(40, Number(s.background_fade) || 85)),
        online_payments_enabled: !!s.online_payments_enabled,
        require_account: s.require_account !== false,
        cash_after_orders: Math.min(50, Math.max(0, Math.round(Number(s.cash_after_orders ?? 3)) || 0)),
        hero_url: s.hero_url || null,
        home_cafe_color: isHex(s.home_cafe_color) ? s.home_cafe_color : null,
        home_cafe_logo_url: s.home_cafe_logo_url || null,
        home_cafe_bg_url: s.home_cafe_bg_url || null,
        home_bay_color: isHex(s.home_bay_color) ? s.home_bay_color : null,
        home_bay_logo_url: s.home_bay_logo_url || null,
        home_bay_bg_url: s.home_bay_bg_url || null,
      })
      .eq("id", 1);
    setBusy(false);
    if (!error) setLocal(s); // update header/logo here immediately; other screens update via realtime
    setMsg(error ? { tone: "red", text: error.message } : { tone: "green", text: "Settings saved." });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold">Store settings</h1>
      <form onSubmit={save} className="space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <BrandingSection s={s} set={set} setMsg={setMsg} uploading={uploading} setUploading={setUploading} />

        <section className="card space-y-4 p-5">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-bold">Accepting orders</span>
              <span className="text-sm text-coffee-700">Turn off to close early (power outage, sold out, typhoon).</span>
            </span>
            <Toggle checked={s.is_open} onChange={(v) => set("is_open", v)} label="Accepting orders" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="open">
                Opens
              </label>
              <input id="open" type="time" className="input" value={s.open_time.slice(0, 5)} onChange={(e) => set("open_time", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="close">
                Closes
              </label>
              <input id="close" type="time" className="input" value={s.close_time.slice(0, 5)} onChange={(e) => set("close_time", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="c-phone">
                Café mobile (public)
              </label>
              <input id="c-phone" className="input" inputMode="numeric" value={s.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="c-email">
                Café email (public)
              </label>
              <input id="c-email" type="email" className="input" value={s.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
            </div>
          </div>
          <p className="hint -mt-2">Shown on the privacy policy page, which the app stores require.</p>
          <div>
            <label className="label" htmlFor="closed-msg">
              Message when closed
            </label>
            <input id="closed-msg" className="input" value={s.closed_message} onChange={(e) => set("closed_message", e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="min">
                Minimum for delivery (₱)
              </label>
              <input id="min" type="number" min={0} className="input" value={s.min_delivery_order} onChange={(e) => set("min_delivery_order", e.target.value as unknown as number)} />
            </div>
            <div>
              <label className="label" htmlFor="prep">
                Usual prep time (min)
              </label>
              <input id="prep" type="number" min={5} max={120} className="input" value={s.prep_minutes} onChange={(e) => set("prep_minutes", e.target.value as unknown as number)} />
            </div>
          </div>
        </section>

        <section className="card space-y-2 p-5">
          <h2 className="section-title">Customer accounts</h2>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-coffee-700"
              checked={s.require_account !== false}
              onChange={(e) => set("require_account", e.target.checked)}
            />
            <span>
              <span className="font-semibold">Customers must sign in to order or book</span>
              <span className="block text-sm text-coffee-600">
                Anyone can browse the menu and scooters. To place a café order or book a scooter, customers sign in or create an
                account (with Google or a mobile number). Turn off to allow guest orders.
              </span>
            </span>
          </label>
        </section>

        <section className="card space-y-2 p-5" data-testid="cash-rule">
          <h2 className="section-title">Cash payments</h2>
          <label className="label" htmlFor="cash-after">
            Allow cash after this many completed orders
          </label>
          <input
            id="cash-after"
            type="number"
            min={0}
            max={50}
            className="input w-32"
            value={s.cash_after_orders ?? 3}
            onChange={(e) => set("cash_after_orders", e.target.value as unknown as number)}
          />
          <p className="hint">New customers pay by GCash until they have this many completed orders; then Cash on delivery / pickup unlocks. 0 = cash for everyone.</p>
        </section>

        <OnlinePaymentsSection enabled={!!s.online_payments_enabled} onChange={(v) => set("online_payments_enabled", v)} />

        <section className="card space-y-4 p-5">
          <h2 className="section-title">{s.online_payments_enabled ? "Manual GCash (fallback)" : "GCash"}</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-coffee-200 bg-white">
              {s.gcash_qr_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.gcash_qr_url} alt="GCash QR" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="p-3 text-center text-sm text-coffee-600">No QR yet</span>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <label className="btn-secondary btn-sm cursor-pointer">
                {uploading ? <Spinner /> : "Upload GCash QR"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploading(true);
                    try {
                      set("gcash_qr_url", await uploadPublicImage(f, "gcash", { resize: false })); // never recompress a QR code
                      setMsg({ tone: "green", text: "QR uploaded — press Save settings to publish it." });
                    } catch (err) {
                      setMsg({ tone: "red", text: (err as Error).message });
                    }
                    setUploading(false);
                  }}
                />
              </label>
              <p className="hint">In GCash: Profile → My QR Codes → Download.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="gname">
                    Account name
                  </label>
                  <input id="gname" className="input" value={s.gcash_name ?? ""} onChange={(e) => set("gcash_name", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="gnum">
                    GCash number
                  </label>
                  <input id="gnum" className="input" inputMode="numeric" value={s.gcash_number ?? ""} onChange={(e) => set("gcash_number", e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <button className="btn-primary w-full" disabled={busy || uploading}>
          {busy ? <Spinner /> : "Save settings"}
        </button>
      </form>

      {isAdmin && <TeamSection />}
      {isAdmin && <CustomerPasswordReset />}
    </div>
  );
}

/** Trimmed text, or null (= use the default). */
const clean = (v: string | null | undefined) => v?.trim() || null;

type SetFn = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => void;

/** Reads an image file and returns its pixel size (for friendly warnings). */
function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

type BrandTab = "site" | "cafe" | "baybayin" | "account";
type UploadKind = "logo" | "site_logo" | "baybayin" | "account" | "background" | "hero" | "home_cafe_logo" | "home_bay_logo" | "home_cafe_bg" | "home_bay_bg";
const BRAND_TABS: { key: BrandTab; label: string; hint: string }[] = [
  { key: "site", label: "Welcome page", hint: "The home page where customers choose the café or scooter rental, plus the website icon." },
  { key: "cafe", label: "Pahuway Cafe", hint: "Header on the menu, checkout and order status pages." },
  { key: "baybayin", label: "Baybayin", hint: "Header on the Baybayin scooter rental pages and its home-page card." },
  { key: "account", label: "Account page", hint: "The customer sign-in / account page (“Welcome back”): its own header, icon and heading. Empty fields use the café's." },
];

function BrandingSection({
  s,
  set,
  setMsg,
  uploading,
  setUploading,
}: {
  s: StoreSettings;
  set: SetFn;
  setMsg: (m: { tone: "red" | "green"; text: string } | null) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<BrandTab>("site");
  const upload = async (file: File | undefined, kind: UploadKind) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const size = await imageSize(file);
      if (!size) throw new Error("That file doesn't look like an image. Please use JPG, PNG or WebP.");
      const photo = kind === "background" || kind === "hero" || kind === "home_cafe_bg" || kind === "home_bay_bg";
      if (!photo && Math.min(size.w, size.h) < 128) throw new Error("Logo is too small — please use at least 256 × 256 pixels.");
      if ((kind === "background" || kind === "hero") && Math.max(size.w, size.h) < 1000) throw new Error(`${kind === "hero" ? "Photo" : "Background"} is too small — please use at least 1600 pixels wide so it stays sharp.`);
      if ((kind === "home_cafe_bg" || kind === "home_bay_bg") && Math.max(size.w, size.h) < 600) throw new Error("Card photo is too small — please use at least 800 pixels wide.");
      const url = await uploadPublicImage(file, "branding", { maxDim: kind === "background" || kind === "hero" ? 2400 : photo ? 1200 : 800 });
      const field = ({ logo: "logo_url", site_logo: "site_logo_url", baybayin: "baybayin_logo_url", account: "account_logo_url", background: "background_url", hero: "hero_url", home_cafe_logo: "home_cafe_logo_url", home_bay_logo: "home_bay_logo_url", home_cafe_bg: "home_cafe_bg_url", home_bay_bg: "home_bay_bg_url" } as const)[kind];
      set(field, url);
      const squareNote = !photo && Math.abs(size.w - size.h) > Math.min(size.w, size.h) * 0.1 ? " Tip: a square logo looks best — it's shown in a circle." : "";
      const what = { logo: "Logo", site_logo: "Welcome page logo", baybayin: "Baybayin logo", account: "Account page icon", background: "Background", hero: "Welcome page photo", home_cafe_logo: "Café card logo", home_bay_logo: "Scooter card logo", home_cafe_bg: "Café card photo", home_bay_bg: "Scooter card photo" }[kind];
      setMsg({ tone: "green", text: `${what} uploaded — press Save settings to publish it.${squareNote}` });
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    }
    setUploading(false);
  };
  const uploadIcon = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      set("site_icons", await uploadSiteIcons(file));
      setMsg({ tone: "green", text: "Website icon ready — press Save settings to publish it. Browsers can take a little while to show a new tab icon." });
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    }
    setUploading(false);
  };

  const site = brandOf(s, "site");
  const cafe = brandOf(s, "cafe");
  const bay = brandOf(s, "baybayin");
  const acct = brandOf(s, "account");
  const fade = s.background_fade ?? 85;
  const active = BRAND_TABS.find((t) => t.key === tab)!;
  const text = (k: keyof StoreSettings) => ({ value: (s[k] as string | null | undefined) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  return (
    <section className="card space-y-5 p-5" aria-labelledby="branding-title">
      <div>
        <h2 id="branding-title" className="section-title">
          Branding
        </h2>
        <p className="text-sm text-coffee-700">Each part of the site has its own header. Changes appear on the website and in the Padaya home-screen app as soon as you save.</p>
      </div>

      <div role="tablist" aria-label="Which branding" className="flex flex-wrap gap-1 rounded-2xl bg-cream p-1">
        {BRAND_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`brand-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="brand-panel"
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${tab === t.key ? "bg-white text-coffee-900 shadow-card" : "text-coffee-700 hover:bg-white/60"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="brand-panel" aria-labelledby={`brand-tab-${tab}`} className="space-y-5">
        <p className="text-sm text-coffee-700">{active.hint}</p>

        {tab === "site" && (
          <>
            <BrandHeaderPreview brand={site} testId="site-header-preview" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput id="site-name" label="Header title" placeholder={cafe.name} maxLength={40} hint="Empty = the café's name." {...text("site_name")} />
              <TextInput id="site-tagline" label="Tagline" placeholder={cafe.tagline} maxLength={60} hint="Small line under the title (wider screens)." {...text("site_tagline")} />
            </div>
            <LogoField
              label="Logo"
              preview={site.logo}
              emoji={site.emoji}
              ariaUpload="Upload welcome page logo"
              testId="site-logo-preview"
              uploading={uploading}
              hasCustom={!!s.site_logo_url}
              clearLabel="Use the café logo"
              onUpload={(f) => upload(f, "site_logo")}
              onClear={() => set("site_logo_url", null)}
              hint="Square image, at least 256 × 256 px. Empty = the café's logo."
            />
            <ColorField id="site-header-color" label="Welcome page header colour" value={s.site_header_color ?? null} fallback={isHex(cafe.color) ? cafe.color : "#fbf7f0"} onChange={(v) => set("site_header_color", v)} />
            <div className="space-y-3 border-t border-coffee-100 pt-5">
              <p className="font-bold">Welcome text &amp; cards</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput id="welcome-title-input" label="Big title" placeholder={DEFAULTS.welcomeTitle} maxLength={60} {...text("welcome_title")} />
                <TextInput id="welcome-subtitle-input" label="Line under the title" placeholder={DEFAULTS.welcomeSubtitle} maxLength={120} {...text("welcome_subtitle")} />
              </div>
              <TextInput id="cafe-card-text" label={`“Order from ${cafe.name}” card`} placeholder={DEFAULTS.cafeCard} maxLength={140} multiline {...text("cafe_card_text")} />
              <TextInput id="baybayin-card-text" label={`“Rent a scooter from ${bay.name}” card`} placeholder={DEFAULTS.baybayinCard} maxLength={140} multiline hint="Also shown on the Baybayin Coming soon page." {...text("baybayin_card_text")} />
              <p className="hint">Leave any field empty to use the text shown in grey.</p>
            </div>
            <div className="space-y-3 border-t border-coffee-100 pt-5" data-testid="landing-settings">
              <p className="font-bold">Welcome page photo</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-coffee-100 sm:w-48">
                  {s.hero_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.hero_url} alt="Welcome page photo" data-testid="hero-preview" className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-3 text-center text-sm text-coffee-600">Using a menu photo</span>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="btn-secondary btn-sm cursor-pointer">
                    {uploading ? <Spinner /> : "Upload photo"}
                    <input type="file" accept="image/*" className="sr-only" aria-label="Upload welcome page photo" onChange={(e) => upload(e.target.files?.[0], "hero")} />
                  </label>
                  {s.hero_url && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => set("hero_url", null)}>
                      Use a menu photo
                    </button>
                  )}
                  <p className="hint">Big photo at the top of the welcome page. Landscape, at least 1600 px wide. Empty = the first menu photo.</p>
                </div>
              </div>
            </div>
            <div className="space-y-4 border-t border-coffee-100 pt-5" data-testid="home-card-settings">
              <p className="font-bold">Home page cards</p>
              <div className="grid grid-cols-2 gap-3" data-testid="home-card-preview">
                <HomeCard color={s.home_cafe_color} fallbackColor={HOME_CARD_DEFAULTS.cafe} bgUrl={s.home_cafe_bg_url} logo={s.home_cafe_logo_url || cafe.logo} emoji="☕" title="Order food & drinks" text={welcomeTexts(s).cafeCard} status="Open now" />
                <HomeCard color={s.home_bay_color} fallbackColor={HOME_CARD_DEFAULTS.bay} bgUrl={s.home_bay_bg_url} logo={s.home_bay_logo_url || bay.logo} emoji={bay.emoji} title="Book a scooter" text={welcomeTexts(s).baybayinCard} status="Book now" />
              </div>
              {(
                [
                  { key: "cafe", name: "“Order food & drinks” card", color: "home_cafe_color", logo: "home_cafe_logo_url", bg: "home_cafe_bg_url", fallback: HOME_CARD_DEFAULTS.cafe, brandLogo: cafe.logo, emoji: "☕" },
                  { key: "bay", name: "“Book a scooter” card", color: "home_bay_color", logo: "home_bay_logo_url", bg: "home_bay_bg_url", fallback: HOME_CARD_DEFAULTS.bay, brandLogo: bay.logo, emoji: bay.emoji },
                ] as const
              ).map((c) => (
                <div key={c.key} className="space-y-3 rounded-2xl border border-coffee-100 p-4" data-testid={`home-card-${c.key}`}>
                  <p className="font-semibold">{c.name}</p>
                  <ColorField id={`home-${c.key}-color`} label="Background colour" value={s[c.color] ?? null} fallback={c.fallback} onChange={(v) => set(c.color, v)} />
                  <LogoField
                    label="Logo"
                    preview={s[c.logo] || c.brandLogo}
                    emoji={c.emoji}
                    ariaUpload={`Upload ${c.key === "cafe" ? "café" : "scooter"} card logo`}
                    testId={`home-${c.key}-logo-preview`}
                    uploading={uploading}
                    hasCustom={!!s[c.logo]}
                    clearLabel="Use the brand logo"
                    onUpload={(f) => upload(f, c.key === "cafe" ? "home_cafe_logo" : "home_bay_logo")}
                    onClear={() => set(c.logo, null)}
                    hint="Square image, at least 256 × 256 px. Empty = the brand's logo."
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="btn-secondary btn-sm cursor-pointer">
                      {uploading ? <Spinner /> : s[c.bg] ? "Change background photo" : "Add background photo"}
                      <input type="file" accept="image/*" className="sr-only" aria-label={`Upload ${c.key === "cafe" ? "café" : "scooter"} card background photo`} onChange={(e) => upload(e.target.files?.[0], c.key === "cafe" ? "home_cafe_bg" : "home_bay_bg")} />
                    </label>
                    {s[c.bg] && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => set(c.bg, null)}>
                        Remove photo
                      </button>
                    )}
                  </div>
                  <p className="hint">Optional photo behind the card (darkened so the text stays readable). Without one, the card uses the background colour; the text turns dark or light automatically.</p>
                </div>
              ))}
            </div>
            <SiteIconField icons={s.site_icons ?? null} uploading={uploading} onUpload={uploadIcon} onClear={() => set("site_icons", null)} />
          </>
        )}

        {tab === "cafe" && (
          <>
            <BrandHeaderPreview brand={cafe} testId="customer-header-preview" showOpen />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput id="store-name" label="Store name (header title)" placeholder={DEFAULTS.cafeName} maxLength={40} {...text("store_name")} />
              <TextInput id="store-tagline" label="Tagline" placeholder={DEFAULTS.cafeTagline} maxLength={60} hint="Small line under the name (wider screens)." {...text("store_tagline")} />
            </div>
            <LogoField
              label="Logo"
              preview={cafe.logo}
              emoji={cafe.emoji}
              ariaUpload="Upload logo"
              testId="logo-preview"
              uploading={uploading}
              hasCustom={!!s.logo_url}
              clearLabel="Use default logo"
              onUpload={(f) => upload(f, "logo")}
              onClear={() => set("logo_url", null)}
              hint="Square image, at least 256 × 256 px (PNG with a transparent or solid background works best). Max 5 MB."
            />
            <ColorField id="header-color" label="Header colour" value={s.header_color} fallback="#fbf7f0" onChange={(v) => set("header_color", v)} />
          </>
        )}

        {tab === "baybayin" && (
          <>
            <BrandHeaderPreview brand={bay} testId="baybayin-header-preview" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput id="baybayin-name" label="Name (header title)" placeholder={DEFAULTS.baybayinName} maxLength={40} {...text("baybayin_name")} />
              <TextInput id="baybayin-tagline" label="Tagline" placeholder={DEFAULTS.baybayinTagline} maxLength={60} {...text("baybayin_tagline")} />
            </div>
            <LogoField
              label="Baybayin logo"
              preview={bay.logo}
              emoji={bay.emoji}
              ariaUpload="Upload Baybayin logo"
              testId="baybayin-logo-preview"
              uploading={uploading}
              hasCustom={!!s.baybayin_logo_url}
              clearLabel="Remove"
              onUpload={(f) => upload(f, "baybayin")}
              onClear={() => set("baybayin_logo_url", null)}
              hint="Shown in the Baybayin header, on its home-page card and Coming soon page. Square works best, at least 256 × 256 px. Max 5 MB."
            />
            <ColorField id="baybayin-header-color" label="Baybayin header colour" value={s.baybayin_header_color ?? null} fallback="#fbf7f0" onChange={(v) => set("baybayin_header_color", v)} />
          </>
        )}

        {tab === "account" && (
          <>
            <BrandHeaderPreview brand={acct} testId="account-header-preview" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput id="account-name" label="Header title" placeholder={cafe.name} maxLength={40} hint="Empty = the café's name." {...text("account_name")} />
              <TextInput id="account-tagline" label="Tagline" placeholder={cafe.tagline} maxLength={60} hint="Small line under the title (wider screens)." {...text("account_tagline")} />
            </div>
            <LogoField
              label="Account page icon"
              preview={acct.logo}
              emoji={acct.emoji}
              ariaUpload="Upload account page icon"
              testId="account-logo-preview"
              uploading={uploading}
              hasCustom={!!s.account_logo_url}
              clearLabel="Use the café logo"
              onUpload={(f) => upload(f, "account")}
              onClear={() => set("account_logo_url", null)}
              hint="Shown in the account page header. Square works best, at least 256 × 256 px. Max 5 MB."
            />
            <ColorField id="account-header-color" label="Account page header colour" value={s.account_header_color ?? null} fallback={isHex(cafe.color) ? cafe.color : "#fbf7f0"} onChange={(v) => set("account_header_color", v)} />
            <div className="space-y-3 border-t border-coffee-100 pt-4">
              <p className="font-bold">Sign-in heading</p>
              <TextInput id="account-title-input" label="Big title" placeholder={DEFAULTS.accountTitle} maxLength={60} {...text("account_title")} />
              <TextInput id="account-subtitle-input" label="Line under the title" placeholder={DEFAULTS.accountSubtitle} maxLength={160} multiline {...text("account_subtitle")} />
            </div>
          </>
        )}
      </div>

      {/* Background (all customer pages) */}
      <div className="space-y-3 border-t border-coffee-100 pt-5">
        <p className="font-bold">Background image <span className="font-normal text-coffee-600">(all customer pages)</span></p>
        <div className="relative isolate h-44 overflow-hidden rounded-2xl border border-coffee-200 bg-cream" data-testid="background-preview">
          {s.background_url ? (
            <BackgroundLayer url={s.background_url} fade={fade} fixed={false} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-coffee-600">No background — plain cream</div>
          )}
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cafe.logo ?? undefined} alt="" className="h-10 w-10 rounded-full object-cover" />
            <div className="flex-1">
              <p className="font-bold leading-tight">Café Latte</p>
              <p className="text-sm text-coffee-700">Preview of a menu card</p>
            </div>
            <span className="font-bold">₱150</span>
          </div>
          <p className="absolute left-3 right-3 top-3 font-display text-lg font-bold leading-tight text-coffee-900">Welcome, guest!</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary btn-sm cursor-pointer">
            {uploading ? <Spinner /> : s.background_url ? "Change background" : "Upload background"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload background" onChange={(e) => upload(e.target.files?.[0], "background")} />
          </label>
          {s.background_url && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => set("background_url", null)}>
              Remove background
            </button>
          )}
        </div>
        {s.background_url && (
          <div>
            <label className="label" htmlFor="fade">
              Fade: {fade}% <span className="font-normal text-coffee-600">(higher = softer photo, easier to read)</span>
            </label>
            <input id="fade" type="range" min={40} max={95} step={5} value={fade} onChange={(e) => set("background_fade", Number(e.target.value))} className="w-full accent-coffee-700" />
          </div>
        )}
        <p className="hint">Landscape photo, at least 1600 px wide (e.g. your café interior or a coffee close-up). Shown behind customer pages only, not the staff screens. Max 5 MB.</p>
      </div>

      <StaffHeaderSettings s={s} set={set} logo={cafe.logo ?? DEFAULT_LOGO} />

      <p className="rounded-2xl bg-cream-100 px-4 py-3 text-sm text-coffee-700">
        The website icon above is also the <strong>Padaya</strong> app icon when customers add the site to their home screen. Phones that already added it may keep the old icon until it&apos;s removed and added again.
      </p>
    </section>
  );
}

function BrandHeaderPreview({ brand, testId, showOpen = false }: { brand: Brand; testId: string; showOpen?: boolean }) {
  const t = isHex(brand.color) ? headerTheme(brand.color) : null;
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between gap-3 rounded-2xl border border-coffee-200 px-4 py-3"
      style={{ background: t?.bg ?? "#fbf7f0", color: t?.fg ?? "#2e1e14" }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xl">
            {brand.emoji}
          </span>
        )}
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-display text-lg font-bold">{brand.name}</span>
          {brand.tagline && (
            <span className="block truncate text-xs" style={{ color: t?.muted ?? "#714a2f" }}>
              {brand.tagline}
            </span>
          )}
        </span>
      </span>
      {showOpen && <span className="rounded-full bg-sage-100 px-3 py-1 text-xs font-bold text-sage-700">Open</span>}
    </div>
  );
}

function TextInput({
  id,
  label,
  hint,
  multiline,
  ...rest
}: {
  id: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {multiline ? <textarea id={id} className="input min-h-[72px] py-2" rows={2} {...rest} /> : <input id={id} className="input" {...rest} />}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function LogoField(p: {
  label: string;
  preview: string | null;
  emoji: string;
  ariaUpload: string;
  testId: string;
  uploading: boolean;
  hasCustom: boolean;
  clearLabel: string;
  onUpload: (f: File | undefined) => void;
  onClear: () => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {p.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.preview} alt={`Current ${p.label.toLowerCase()}`} className="h-24 w-24 shrink-0 rounded-full border border-coffee-200 bg-white object-cover" data-testid={p.testId} />
      ) : (
        <span aria-hidden className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-sky-100 text-4xl">
          {p.emoji}
        </span>
      )}
      <div className="flex-1 space-y-2">
        <p className="font-bold">{p.label}</p>
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary btn-sm cursor-pointer">
            {p.uploading ? <Spinner /> : p.hasCustom ? `Change ${p.label.toLowerCase()}` : `Upload ${p.label.toLowerCase()}`}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={p.ariaUpload} onChange={(e) => p.onUpload(e.target.files?.[0])} />
          </label>
          {p.hasCustom && (
            <button type="button" className="btn-ghost btn-sm" onClick={p.onClear}>
              {p.clearLabel}
            </button>
          )}
        </div>
        <p className="hint">{p.hint}</p>
      </div>
    </div>
  );
}

function SiteIconField({ icons, uploading, onUpload, onClear }: { icons: StoreSettings["site_icons"]; uploading: boolean; onUpload: (f: File | undefined) => void; onClear: () => void }) {
  const tab = icons?.["32"] ?? "/logo.svg";
  const home = icons?.["180"] ?? "/icons/icon-192.webp";
  return (
    <div className="space-y-3 border-t border-coffee-100 pt-5">
      <p className="font-bold">Website icon</p>
      <div className="flex flex-wrap items-end gap-6" data-testid="site-icon-preview">
        <div className="text-center">
          <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-coffee-200 bg-white px-3 py-2 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tab} alt="Browser tab icon" className="h-4 w-4" data-testid="site-icon-32" />
            <span className="max-w-[9rem] truncate">Pahuway Cafe — Order…</span>
          </div>
          <p className="hint mt-1">Browser tab</p>
        </div>
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={home} alt="Home-screen icon" className="mx-auto h-16 w-16 rounded-2xl border border-coffee-200 object-cover shadow-card" data-testid="site-icon-180" />
          <p className="hint mt-1">Phone home screen</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary btn-sm cursor-pointer">
          {uploading ? <Spinner /> : icons ? "Change website icon" : "Upload website icon"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload website icon" onChange={(e) => onUpload(e.target.files?.[0])} />
        </label>
        {icons && (
          <button type="button" className="btn-ghost btn-sm" onClick={onClear}>
            Use default icon
          </button>
        )}
      </div>
      <p className="hint">Square image, at least 512 × 512 px (a simple logo on a solid background reads best when tiny). We make the tab and home-screen sizes for you.</p>
    </div>
  );
}

const SWATCHES = ["#fbf7f0", "#ffffff", "#efe4d8", "#432c1d", "#2e1e14", "#556c4d", "#435639", "#1e3a5f", "#7a2e2e", "#c2410c"];

function ColorField({ id, label, value, fallback, onChange }: { id: string; label: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  const current = isHex(value) ? value : fallback;
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const theme = headerTheme(current);
  return (
    <div className="space-y-2">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Use colour ${c}`}
            aria-pressed={current.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={`h-9 w-9 rounded-full border-2 ${current.toLowerCase() === c ? "border-coffee-900 ring-2 ring-coffee-300" : "border-coffee-200"}`}
            style={{ background: c }}
          />
        ))}
        <label className="relative flex h-9 cursor-pointer items-center gap-2 rounded-full border border-coffee-200 bg-white pl-1 pr-3 text-sm font-semibold">
          <input type="color" value={current} onChange={(e) => onChange(e.target.value)} className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label={`${label}: custom colour`} />
          Custom
        </label>
        <input
          id={id}
          className="input h-9 min-h-0 w-28 rounded-full px-3 font-mono text-sm"
          value={text}
          maxLength={7}
          aria-label={`${label}: hex code`}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
            setText(v);
            if (isHex(v)) onChange(v.toLowerCase());
          }}
        />
        {isHex(value) && (
          <button type="button" className="btn-ghost btn-sm" aria-label={`${label}: use default`} onClick={() => onChange(null)}>
            Default
          </button>
        )}
      </div>
      {theme.ratio < 4.5 && (
        <p className="error-text" role="alert">
          This colour makes header text hard to read (contrast {theme.ratio.toFixed(1)}:1, minimum 4.5:1). Try a darker or lighter shade.
        </p>
      )}
    </div>
  );
}

function StaffHeaderSettings({ s, set, logo }: { s: StoreSettings; set: SetFn; logo: string }) {
  const staff = headerTheme(isHex(s.staff_header_color) ? s.staff_header_color : DEFAULT_STAFF_HEADER);
  const staffTitle = s.staff_title?.trim() || "Pahuway Staff";
  return (
    <div className="space-y-6 border-t border-coffee-100 pt-5">
      {/* Staff header */}
      <div className="space-y-3">
        <p className="font-bold">Staff header</p>
        <div
          data-testid="staff-header-preview"
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{ background: staff.bg, color: staff.fg }}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-full bg-cream object-cover" />
            <span className="truncate font-display text-lg font-bold">{staffTitle}</span>
          </span>
          <span className="flex gap-1 text-sm font-semibold">
            <span className="rounded-lg px-2.5 py-1" style={{ background: staff.activeBg, color: staff.activeFg }}>
              Orders
            </span>
            <span className="rounded-lg px-2.5 py-1" style={{ color: staff.muted }}>
              Menu
            </span>
          </span>
        </div>
        <div>
          <label className="label" htmlFor="staff-title">
            Staff header title
          </label>
          <input id="staff-title" className="input" value={s.staff_title ?? ""} maxLength={40} onChange={(e) => set("staff_title", e.target.value)} placeholder="Pahuway Staff" />
        </div>
        <ColorField id="staff-color" label="Staff header colour" value={s.staff_header_color} fallback={DEFAULT_STAFF_HEADER} onChange={(v) => set("staff_header_color", v)} />
      </div>
    </div>
  );
}

function OnlinePaymentsSection({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; testMode: boolean; methods: string[] } | null>(null);
  useEffect(() => {
    fetch("/api/payments/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, testMode: false, methods: [] }));
  }, []);
  const ready = !!status?.configured;
  return (
    <section className="card space-y-3 p-5" aria-labelledby="online-pay-title">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span id="online-pay-title" className="block font-bold">
            Online payments (HitPay)
          </span>
          <span className="text-sm text-coffee-700">Customers pay with GCash or QR Ph at checkout. Orders reach the board only after payment is confirmed.</span>
        </span>
        <Toggle checked={enabled && ready} onChange={onChange} disabled={!ready} label="Accept online payments" />
      </label>
      {status && !ready && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="payments-not-configured">
          Not set up yet: add your HitPay API key and salt to the website&apos;s server settings first (see docs/PAYMENTS.md). Until then customers can pay cash or manual GCash.
        </p>
      )}
      {ready && status?.testMode && (
        <p className="rounded-2xl bg-sky-100 px-4 py-3 text-sm text-sky-900">
          <strong>Test mode:</strong> HitPay sandbox is active, so no real money moves. Set HITPAY_ENV=live with your live keys before opening to customers.
        </p>
      )}
    </section>
  );
}
