// Team permissions — shared by the server checks, navigation and the Team form.
// The database enforces the same list (see supabase/migrations/0008_team_permissions.sql).

export const PERMISSIONS = [
  { key: "orders", label: "Orders board", hint: "Accept orders, update status, assign riders, verify GCash" },
  { key: "stock", label: "Sold-out switches", hint: "Mark items and options (e.g. oat milk) sold out" },
  { key: "open_close", label: "Open / close the store", hint: "The open-for-orders switch in the header" },
  { key: "menu", label: "Menu & options", hint: "Items, prices, photos, categories, choices" },
  { key: "zones", label: "Delivery zones", hint: "Barangays and delivery fees" },
  { key: "refunds", label: "Refunds", hint: "Refund paid online orders" },
  { key: "sales", label: "Sales summary", hint: "Daily sales, top items" },
  { key: "settings", label: "Store settings", hint: "Hours, branding, GCash, online payments" },
  { key: "rentals", label: "Scooter rentals", hint: "Baybayin bookings, scooters and rental settings" },
] as const;

export type Perm = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERMS: Perm[] = PERMISSIONS.map((p) => p.key);
export const isPerm = (v: unknown): v is Perm => typeof v === "string" && (ALL_PERMS as string[]).includes(v);

/** Staff-area pages and the permission(s) that open them (any of). */
export const STAFF_PAGES: { href: string; label: string; perms: Perm[] }[] = [
  { href: "/admin", label: "Orders", perms: ["orders"] },
  { href: "/admin/stock", label: "Sold out", perms: ["stock", "menu"] },
  { href: "/admin/menu", label: "Menu", perms: ["menu"] },
  { href: "/admin/options", label: "Options", perms: ["menu"] },
  { href: "/admin/zones", label: "Zones", perms: ["zones"] },
  { href: "/admin/summary", label: "Summary", perms: ["sales"] },
  { href: "/admin/rentals", label: "Rentals", perms: ["rentals"] },
  { href: "/admin/stays", label: "Stays", perms: ["rentals"] },
  { href: "/admin/tours", label: "Tours", perms: ["rentals"] },
  { href: "/admin/settings", label: "Settings", perms: ["settings"] },
];

export const canOpen = (perms: Perm[], page: { perms: Perm[] }) => page.perms.some((p) => perms.includes(p));
/** Where a staff member lands: the first page they're allowed to use. */
export const firstStaffPage = (perms: Perm[]) => STAFF_PAGES.find((p) => canOpen(perms, p))?.href ?? null;
