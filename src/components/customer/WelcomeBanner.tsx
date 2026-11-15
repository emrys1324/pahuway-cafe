import { headerTheme, isHex, rgba } from "@/lib/color";

/**
 * Welcome banner on the home page. With a banner colour it shows that exact colour (no darkening) and picks
 * white or dark text for contrast; otherwise it shows the welcome photo under a dark gradient with white text.
 */
export function WelcomeBanner({ color, photo, title, subtitle, textColor, eyebrow }: { color?: string | null; photo?: string | null; title: string; subtitle?: string | null; textColor?: string | null; eyebrow?: string | null }) {
  const solid = isHex(color) ? headerTheme(color) : null;
  const custom = isHex(textColor) ? textColor : null; // empty = automatic
  return (
    <section
      data-testid="hero"
      data-banner={solid ? "colour" : "photo"}
      className={`relative isolate overflow-hidden rounded-3xl shadow-lg ${solid ? "" : "bg-coffee-900 text-white"}`}
      style={{ ...(solid ? { background: solid.bg, color: solid.fg } : {}), ...(custom ? { color: custom } : {}) }}
    >
      {!solid && photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" data-testid="hero-photo" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      )}
      {!solid && <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/50 to-black/20" />}
      {/* hills and sea along the bottom, like an island skyline */}
      <svg aria-hidden viewBox="0 0 1200 150" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 -z-0 h-16 w-full sm:h-20">
        <path d="M0 80 L120 50 L200 70 L330 30 L460 72 L560 58 L700 40 L820 70 L960 46 L1080 66 L1200 52 V150 H0Z" fill="#ea580c" opacity=".18" />
        <path d="M0 100 Q200 78 400 98 T800 92 T1200 96 V150 H0Z" fill="#c2410c" opacity=".22" />
        <path d="M0 128 Q300 112 600 126 T1200 122 V150 H0Z" fill="#9a3412" opacity=".18" />
      </svg>
      <div className="relative flex min-h-[150px] flex-col justify-end gap-1 px-5 pb-10 pt-5 sm:min-h-[190px] sm:px-8 sm:pb-12">
        <div>
          {eyebrow && (
            <span data-testid="hero-eyebrow" className="mb-2 inline-block rounded-full bg-orange-600/15 px-3 py-1 text-xs font-bold text-orange-800 ring-1 ring-orange-600/20" style={solid ? undefined : { background: "rgba(255,255,255,.18)", color: "#fff" }}>
              {eyebrow}
            </span>
          )}
          <h1 data-testid="welcome-title" className={`font-display text-3xl font-bold leading-tight sm:text-4xl ${solid ? "" : "drop-shadow"}`}>
            {title}
          </h1>
          {subtitle && (
            <p data-testid="welcome-subtitle" className={`text-base sm:text-lg ${solid || custom ? "" : "text-white/90 drop-shadow"} ${!solid ? "drop-shadow" : ""}`} style={custom ? { color: rgba(custom, 0.9) } : solid ? { color: solid.muted } : undefined}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
