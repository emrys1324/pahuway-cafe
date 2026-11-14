"use client";
/** Vehicle photo, or a 🛵 / 🚗 tile when there's none (instead of the café placeholder). */
export function ScooterPhoto({ src, alt, className = "", car = false }: { src: string | null; alt: string; className?: string; car?: boolean }) {
  if (!src)
    return (
      <span aria-hidden className={`flex items-center justify-center bg-sky-100 text-3xl ${className}`}>
        {car ? "🚗" : "🛵"}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}
