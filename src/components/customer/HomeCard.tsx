import Link from "next/link";
import { headerTheme, isHex } from "@/lib/color";

export const HOME_CARD_DEFAULTS = { cafe: "#432c1d", bay: "#075985" } as const;

export interface HomeCardProps {
  href?: string; // omitted in the Settings preview
  testId?: string;
  color: string | null | undefined; // background colour (hex); empty = default
  fallbackColor: string;
  bgUrl?: string | null; // optional background photo (darkened so text stays readable)
  logo: string | null; // icon in the corner; null = emoji
  emoji: string;
  logoTestId?: string;
  title: string;
  text?: string | null;
  status: string;
}

/** One of the two big Home cards ("Order food & drinks" / "Book a scooter"). Text colour adapts to the background. */
export function HomeCard(p: HomeCardProps) {
  const bg = isHex(p.color) ? p.color : p.fallbackColor;
  const theme = headerTheme(bg);
  const light = !!p.bgUrl || theme.dark; // photo backgrounds are darkened → light text
  const fg = p.bgUrl ? "#ffffff" : theme.fg;
  const muted = p.bgUrl ? "rgba(255,255,255,0.85)" : theme.muted;
  const className = `group relative isolate flex flex-col gap-3 overflow-hidden rounded-3xl p-4 shadow-lg transition-[transform,box-shadow] sm:p-5 ${p.href ? "hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coffee-800" : ""}`;
  const inner = (
    <>
      {p.bgUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.bgUrl} alt="" data-testid="home-card-bg" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/50 to-black/30" />
        </>
      )}
      {p.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.logo} alt="" data-testid={p.logoTestId} className="h-12 w-12 rounded-2xl bg-white object-contain p-0.5 sm:h-14 sm:w-14" />
      ) : (
        <span aria-hidden className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl sm:h-14 sm:w-14 sm:text-3xl ${light ? "bg-white/15" : "bg-black/10"}`}>
          {p.emoji}
        </span>
      )}
      <span>
        <span className="block font-display text-lg font-bold leading-tight sm:text-2xl">{p.title}</span>
        {p.text && (
          <span className="mt-1 line-clamp-2 block text-sm" style={{ color: muted }}>
            {p.text}
          </span>
        )}
      </span>
      <span className="mt-auto flex items-end justify-between gap-2 text-sm font-semibold" style={{ color: muted }}>
        <span>{p.status}</span>
        <span aria-hidden className="text-xl transition group-hover:translate-x-1">
          →
        </span>
      </span>
    </>
  );
  const style = { background: bg, color: fg };
  return p.href ? (
    <Link href={p.href} data-testid={p.testId} className={className} style={style}>
      {inner}
    </Link>
  ) : (
    <div data-testid={p.testId} className={className} style={style}>
      {inner}
    </div>
  );
}
