import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartProvider } from "@/lib/cart";
import { NativeBridge } from "@/components/NativeBridge";
import { ServiceWorkerRegister } from "@/components/InstallPrompt";
import { BrandBackground } from "@/components/BrandBackground";
import { BottomNav } from "@/components/customer/BottomNav";
import { StoreSettingsProvider } from "@/lib/store-settings";
import { getSiteIcons } from "@/lib/site-icons";

const BASE_METADATA: Metadata = {
  title: "Padaya",
  description: "Specialty coffee in San Agustin, Romblon. Order for pickup, dine-in or delivery.",
  appleWebApp: { capable: true, title: "Padaya", statusBarStyle: "default" },
  applicationName: "Padaya",
  manifest: "/manifest.webmanifest",
};

/** Browser-tab and home-screen icons: the one uploaded in Settings → Branding, else the bundled ones. */
export async function generateMetadata(): Promise<Metadata> {
  const icons = await getSiteIcons();
  return {
    ...BASE_METADATA,
    icons: icons
      ? {
          icon: [
            { url: icons["32"] ?? icons["192"]!, sizes: "32x32", type: "image/png" },
            { url: icons["192"]!, sizes: "192x192", type: "image/png" },
          ],
          apple: icons["180"] ?? icons["192"],
        }
      : { icon: "/logo.svg", apple: "/icons/icon-192.webp" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5a3a25",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NativeBridge />
        <ServiceWorkerRegister />
        <StoreSettingsProvider>
          <BrandBackground />
          <CartProvider>
            {children}
            <BottomNav />
          </CartProvider>
        </StoreSettingsProvider>
      </body>
    </html>
  );
}
