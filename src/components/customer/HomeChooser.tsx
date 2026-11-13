"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StoreHeader } from "./Header";
import { HomeShortcuts } from "./HomeShortcuts";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useFirstName } from "@/lib/use-first-name";
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
      .limit(1)
      .then(({ data }) => setFood((data as Thumb[]) ?? []));
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
          <div className="flex min-h-[220px] flex-col justify-end gap-4 p-5 sm:min-h-[280px] sm:p-8">
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
          </div>
        </section>

        {/* The two main actions, right under the welcome header */}
        <nav aria-label="What would you like to do?" className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="main-actions">
          <Link
            href="/menu"
            data-testid="choose-cafe"
            className="group flex flex-col gap-3 rounded-3xl bg-coffee-800 p-4 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coffee-800 sm:p-5"
          >
            {cafe.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cafe.logo} alt="" className="h-12 w-12 rounded-2xl bg-cream object-cover sm:h-14 sm:w-14" />
            ) : (
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl sm:h-14 sm:w-14 sm:text-3xl">
                ☕
              </span>
            )}
            <span>
              <span className="block font-display text-lg font-bold leading-tight sm:text-2xl">Order food &amp; drinks</span>
              {t.cafeCard && <span className="mt-1 line-clamp-2 block text-sm text-white/80">{t.cafeCard}</span>}
            </span>
            <span className="mt-auto flex items-end justify-between gap-2 text-sm font-semibold text-white/90">
              <span>{count > 0 ? `${count} item${count === 1 ? "" : "s"} in cart` : cafeStatus?.text ?? "See the menu"}</span>
              <span aria-hidden className="text-xl transition group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
          <Link
            href="/baybayin"
            data-testid="choose-scooter"
            className="group flex flex-col gap-3 rounded-3xl bg-sky-800 p-4 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800 sm:p-5"
          >
            {bay.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bay.logo} alt="" data-testid="baybayin-logo" className="h-12 w-12 rounded-2xl bg-white object-contain p-1 sm:h-14 sm:w-14" />
            ) : (
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl sm:h-14 sm:w-14 sm:text-3xl">
                {bay.emoji}
              </span>
            )}
            <span>
              <span className="block font-display text-lg font-bold leading-tight sm:text-2xl">{rentOpen ? "Book a scooter" : "Scooter rentals"}</span>
              {t.baybayinCard && <span className="mt-1 line-clamp-2 block text-sm text-white/80">{t.baybayinCard}</span>}
            </span>
            <span className="mt-auto flex items-end justify-between gap-2 text-sm font-semibold text-white/90">
              <span>{rs ? (rentOpen ? "Book now" : "Coming soon") : bay.name}</span>
              <span aria-hidden className="text-xl transition group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
        </nav>

        <HomeShortcuts />

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
