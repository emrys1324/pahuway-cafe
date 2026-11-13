"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useFirstName } from "@/lib/use-first-name";
import { Badge } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { formatClock } from "@/lib/hours";
import { useStoreSettings } from "@/lib/store-settings";
import { brandOf, welcomeTexts } from "@/lib/brands";
import { getSupabase } from "@/lib/supabase/client";
import { bookingsOpen, rentalHours, slotLabel, useRentalSettings } from "@/lib/rentals";

type Thumb = { id: string; name: string; photo_url: string };

/** Home (landing page): hero, your shortcuts, the two services with photos, then hours / location / contact / how it works. */
export function HomeChooser() {
  const { settings, open } = useStoreSettings();
  const { count } = useCart();
  const site = brandOf(settings, "site");
  const cafe = brandOf(settings, "cafe");
  const bay = brandOf(settings, "baybayin");
  const t = welcomeTexts(settings);
  const rs = useRentalSettings();
  const firstName = useFirstName();
  const [food, setFood] = useState<Thumb[]>([]);
  const [scooters, setScooters] = useState<Thumb[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from("menu_items")
      .select("id, name, photo_url")
      .eq("is_active", true)
      .eq("is_sold_out", false)
      .not("photo_url", "is", null)
      .order("sort_order")
      .order("name")
      .limit(8)
      .then(({ data }) => setFood((data as Thumb[]) ?? []));
    supabase
      .from("scooters")
      .select("id, name, photo_url")
      .eq("is_active", true)
      .not("photo_url", "is", null)
      .order("sort_order")
      .limit(4)
      .then(({ data }) => setScooters((data as Thumb[]) ?? []));
  }, []);

  const hero = settings?.hero_url || food[0]?.photo_url || null;
  const rentOpen = !!rs && bookingsOpen(rs);
  const rh = rentalHours(rs);

  const cafeStatus = !settings
    ? null
    : open
      ? { tone: "text-sage-700", text: `Open now · until ${formatClock(settings.close_time)}` }
      : settings.is_open
        ? { tone: "text-coffee-700", text: `Closed now · opens ${formatClock(settings.open_time)}` }
        : { tone: "text-coffee-700", text: "Closed for now" };

  const msgr = rs?.messenger_url || null;
  const phone = settings?.contact_phone || null;
  const email = settings?.contact_email || null;
  const steps = useMemo(
    () => ({
      cafe: ["Pick drinks and food from the menu", "Choose pickup, dine-in or delivery and pay cash or GCash", "Follow your order live until it's ready"],
      bay: ["Pick your dates and a scooter on the calendar", "Upload your driver's license and send the deposit", "Pick up the scooter — show your booking page"],
    }),
    [],
  );

  return (
    <div className="min-h-screen pb-10">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:py-8">
        {/* Hero */}
        <section data-testid="hero" className="relative isolate overflow-hidden rounded-3xl bg-coffee-900 text-white shadow-lg">
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt="" data-testid="hero-photo" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          )}
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/50 to-black/20" />
          <div className="flex min-h-[300px] flex-col justify-end gap-4 p-5 sm:min-h-[360px] sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-white/85">
              {site.name}
              {site.tagline && <span className="font-normal normal-case tracking-normal text-white/75"> · {site.tagline}</span>}
            </p>
            <div>
              <h1 data-testid="welcome-title" className="font-display text-4xl font-bold leading-tight drop-shadow sm:text-5xl">
                {firstName ? `Welcome, ${firstName}!` : t.title}
              </h1>
              {t.subtitle && (
                <p data-testid="welcome-subtitle" className="mt-1 text-lg text-white/90 drop-shadow">
                  {t.subtitle}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/menu" className="btn-primary bg-white text-coffee-900 hover:bg-cream" data-testid="hero-order">
                Order food &amp; drinks
              </Link>
              <Link href="/baybayin" className="btn-secondary border-white/70 bg-white/10 text-white backdrop-blur hover:bg-white/20" data-testid="hero-rent">
                {rentOpen ? "Book a scooter" : "Scooter rentals"}
              </Link>
            </div>
          </div>
        </section>

        <HomeShortcuts />

        {/* The two services */}
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Choose a service">
          <li>
            <Link href="/menu" data-testid="choose-cafe" className="card group flex h-full flex-col overflow-hidden transition hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-coffee-700">
              <PhotoStrip photos={food.slice(0, 4)} testId="cafe-photos" />
              <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cafe.logo ?? undefined} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-cream object-cover" />
                  <span className="font-display text-xl font-bold leading-snug">Order from {cafe.name}</span>
                </div>
                {t.cafeCard && <span className="text-coffee-700">{t.cafeCard}</span>}
                {cafeStatus && <span className={`text-sm font-semibold ${cafeStatus.tone}`}>{cafeStatus.text}</span>}
                {count > 0 && (
                  <span className="text-sm font-semibold text-coffee-800">
                    Continue your order · {count} item{count === 1 ? "" : "s"} in cart
                  </span>
                )}
                <span className="btn-primary mt-auto w-full">{count > 0 ? "Continue order →" : "See the menu →"}</span>
              </div>
            </Link>
          </li>
          <li>
            <Link href="/baybayin" data-testid="choose-scooter" className="card group flex h-full flex-col overflow-hidden transition hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-coffee-700">
              <PhotoStrip photos={scooters} testId="scooter-photos" />
              <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  {bay.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bay.logo} alt="" data-testid="baybayin-logo" className="h-14 w-14 shrink-0 rounded-2xl bg-white object-contain p-1" />
                  ) : (
                    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-3xl">
                      {bay.emoji}
                    </span>
                  )}
                  <span className="font-display text-xl font-bold leading-snug">Rent a scooter from {bay.name}</span>
                </div>
                {rs && <span>{rentOpen ? <Badge tone="green">Book now</Badge> : <Badge tone="amber">Coming soon</Badge>}</span>}
                {t.baybayinCard && <span className="text-coffee-700">{t.baybayinCard}</span>}
                <span className="btn-primary mt-auto w-full">{rentOpen ? "Book a scooter →" : "Learn more →"}</span>
              </div>
            </Link>
          </li>
        </ul>

        <InstallPrompt />

        {/* Hours, location, contact */}
        <section data-testid="info" className={`card grid gap-5 p-5 ${settings?.location_text ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div>
            <h2 className="section-title mb-1">Opening hours</h2>
            {settings && (
              <p className="text-sm text-coffee-800">
                <span className="font-semibold">{cafe.name}</span>
                <br />
                {formatClock(settings.open_time)} – {formatClock(settings.close_time)}
                {!settings.is_open && <span className="block text-coffee-600">Closed for now</span>}
              </p>
            )}
            {rs && (
              <p className="mt-2 text-sm text-coffee-800">
                <span className="font-semibold">{bay.name} pickup &amp; return</span>
                <br />
                {slotLabel(rh.open)} – {slotLabel(rh.close)}
              </p>
            )}
          </div>
          {settings?.location_text && (
            <div>
              <h2 className="section-title mb-1">Find us</h2>
              <p className="text-sm text-coffee-800" data-testid="location-text">
                {settings.location_text}
              </p>
              {settings.location_map_url && (
                <a href={settings.location_map_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold underline" data-testid="location-map">
                  Open in Maps ↗
                </a>
              )}
            </div>
          )}
          <div>
            <h2 className="section-title mb-1">Contact us</h2>
            <ul className="space-y-1 text-sm">
              {phone && (
                <li>
                  <a href={`tel:${phone.replace(/\s+/g, "")}`} className="font-semibold underline" data-testid="contact-call">
                    Call {phone}
                  </a>
                </li>
              )}
              {msgr && (
                <li>
                  <a href={msgr} target="_blank" rel="noopener noreferrer" className="font-semibold underline" data-testid="contact-messenger">
                    Message us on Messenger ↗
                  </a>
                </li>
              )}
              {email && (
                <li>
                  <a href={`mailto:${email}`} className="font-semibold underline">
                    {email}
                  </a>
                </li>
              )}
              {!phone && !msgr && !email && <li className="text-coffee-700">Ask us at the café.</li>}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section data-testid="how-it-works" className="card p-5">
          <h2 className="section-title mb-3">How it works</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                [`Ordering from ${cafe.name}`, steps.cafe],
                [`Renting from ${bay.name}`, steps.bay],
              ] as const
            ).map(([title, list]) => (
              <div key={title}>
                <p className="mb-2 font-semibold">{title}</p>
                <ol className="space-y-2">
                  {list.map((s, i) => (
                    <li key={s} className="flex gap-3 text-sm text-coffee-800">
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-coffee-100 text-xs font-bold text-coffee-800">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/** Up to 4 square photos across the top of a service card (hidden when there are none). */
function PhotoStrip({ photos, testId }: { photos: Thumb[]; testId: string }) {
  if (photos.length === 0) return null;
  return (
    <div data-testid={testId} className="grid h-28 gap-0.5 bg-coffee-100 sm:h-32" style={{ gridTemplateColumns: `repeat(${Math.min(4, photos.length)}, minmax(0, 1fr))` }}>
      {photos.slice(0, 4).map((p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={p.id} src={p.photo_url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
      ))}
    </div>
  );
}
