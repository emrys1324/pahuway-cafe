"use client";
import { usePathname } from "next/navigation";
import { useStoreSettings } from "@/lib/store-settings";

const STAFF_ROUTES = ["/admin", "/rider", "/login"];

/**
 * The admin-chosen background photo, shown behind customer pages only. A cream
 * overlay ("fade") keeps text readable; cards stay solid white on top of it.
 */
export function BrandBackground() {
  const path = usePathname() ?? "/";
  const { settings } = useStoreSettings();
  // the landing page has its own hero photo instead
  if (!settings?.background_url || path === "/" || STAFF_ROUTES.some((r) => path.startsWith(r))) return null;
  return <BackgroundLayer url={settings.background_url} fade={settings.background_fade ?? 85} />;
}

export function BackgroundLayer({ url, fade, fixed = true }: { url: string; fade: number; fixed?: boolean }) {
  return (
    <div aria-hidden className={`${fixed ? "fixed" : "absolute"} inset-0 -z-10 overflow-hidden`} data-testid={fixed ? "brand-background" : "brand-background-preview"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-cream" style={{ opacity: Math.min(95, Math.max(40, fade)) / 100 }} />
    </div>
  );
}
