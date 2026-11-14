import { headerTheme, isHex } from "@/lib/color";

/**
 * Welcome banner on the home page. With a banner colour it shows that exact colour (no darkening) and picks
 * white or dark text for contrast; otherwise it shows the welcome photo under a dark gradient with white text.
 */
export function WelcomeBanner({ color, photo, title, subtitle }: { color?: string | null; photo?: string | null; title: string; subtitle?: string | null }) {
  const solid = isHex(color) ? headerTheme(color) : null;
  return (
    <section
      data-testid="hero"
      data-banner={solid ? "colour" : "photo"}
      className={`relative isolate overflow-hidden rounded-3xl shadow-lg ${solid ? "" : "bg-coffee-900 text-white"}`}
      style={solid ? { background: solid.bg, color: solid.fg } : undefined}
    >
      {!solid && photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" data-testid="hero-photo" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      )}
      {!solid && <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/50 to-black/20" />}
      <div className="flex min-h-[110px] flex-col justify-end gap-1 px-5 py-4 sm:min-h-[140px] sm:px-8 sm:py-5">
        <div>
          <h1 data-testid="welcome-title" className={`font-display text-3xl font-bold leading-tight sm:text-4xl ${solid ? "" : "drop-shadow"}`}>
            {title}
          </h1>
          {subtitle && (
            <p data-testid="welcome-subtitle" className={`text-base sm:text-lg ${solid ? "" : "text-white/90 drop-shadow"}`} style={solid ? { color: solid.muted } : undefined}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
