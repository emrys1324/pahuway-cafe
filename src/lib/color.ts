// Colour helpers for admin-chosen header colours: pick readable text automatically.

export const DEFAULT_STAFF_HEADER = "#432c1d"; // coffee-800
const DARK_TEXT = "#2e1e14"; // coffee-900
const LIGHT_TEXT = "#fbf7f0"; // cream

export const isHex = (v: string | null | undefined): v is string => !!v && /^#[0-9a-fA-F]{6}$/.test(v);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1–21) */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export interface HeaderTheme {
  bg: string;
  fg: string; // main text / icons
  muted: string; // secondary text
  hover: string; // hover background for buttons/links
  activeBg: string; // selected tab background
  activeFg: string; // selected tab text
  dark: boolean; // true = dark background, light text
  ratio: number; // contrast of fg on bg
}

/** Colours for a header with background `bg`, choosing whichever text colour reads better. */
export function headerTheme(bg: string): HeaderTheme {
  const onDark = contrast(bg, LIGHT_TEXT);
  const onLight = contrast(bg, DARK_TEXT);
  const dark = onDark >= onLight;
  const fg = dark ? LIGHT_TEXT : DARK_TEXT;
  return {
    bg,
    fg,
    muted: rgba(fg, 0.85),
    hover: rgba(fg, 0.12),
    activeBg: fg,
    activeFg: bg,
    dark,
    ratio: Math.max(onDark, onLight),
  };
}

/** CSS custom properties for a header (consumed by Tailwind arbitrary values). */
export function headerVars(t: HeaderTheme, prefix: "h" | "s"): React.CSSProperties {
  return {
    [`--${prefix}bg`]: t.bg,
    [`--${prefix}fg`]: t.fg,
    [`--${prefix}muted`]: t.muted,
    [`--${prefix}hover`]: t.hover,
    [`--${prefix}active-bg`]: t.activeBg,
    [`--${prefix}active-fg`]: t.activeFg,
  } as React.CSSProperties;
}
