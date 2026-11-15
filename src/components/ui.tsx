"use client";
import { useEffect } from "react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-coffee-600">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

const BADGE_TONES = {
  brown: "bg-coffee-100 text-coffee-800",
  green: "bg-sage-100 text-sage-700",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  gray: "bg-stone-200 text-stone-800",
  blue: "bg-sky-100 text-sky-900",
} as const;

export function Badge({ tone = "brown", children }: { tone?: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 animate-fade-in bg-coffee-900/50" onClick={onClose} />
      <div
        className={`relative flex max-h-[92vh] w-full animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-cream shadow-2xl sm:rounded-3xl ${
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        }`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-coffee-100 px-5 py-4">
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <button onClick={onClose} className="btn-ghost btn-sm -mr-2 h-10 w-10 !px-0 text-2xl leading-none" aria-label="Close">
              ×
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-coffee-100 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  tone = "green",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: "green" | "red";
}) {
  const on = tone === "green" ? "bg-sage-600" : "bg-red-700";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? on : "bg-stone-300"}`}
    >
      <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${checked ? "translate-x-7" : "translate-x-1"}`} />
    </button>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "green"; children: React.ReactNode }) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    green: "border-sage-200 bg-sage-100 text-sage-700",
  }[tone];
  return (
    <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm font-medium ${cls}`}>
      {children}
    </div>
  );
}

/** Image with a warm placeholder when missing or broken. */
export function ItemPhoto({ src, alt, className = "", emoji = "☕" }: { src: string | null; alt: string; className?: string; emoji?: string }) {
  return (
    <div className={`overflow-hidden bg-coffee-100 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl" aria-hidden>
          {emoji}
        </div>
      )}
    </div>
  );
}
