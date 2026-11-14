import type { OrderStatus, OrderType, PaymentStatus } from "./types";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const formatPeso = (n: number | string) => peso.format(Number(n));

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  dine_in: "Dine-in",
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Received",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  for_verification: "GCash – to verify",
  paid: "Paid",
  awaiting_payment: "Awaiting online payment",
  refunded: "Refunded",
};

/** PH mobile: accepts 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX, with spaces/dashes. Returns 09… or null. */
export function normalizePhone(input: string): string | null {
  let p = input.replace(/[\s\-()]/g, "");
  if (/^\+639\d{9}$/.test(p)) p = "0" + p.slice(3);
  else if (/^639\d{9}$/.test(p)) p = "0" + p.slice(2);
  return /^09\d{9}$/.test(p) ? p : null;
}

/** Strip the internal error code prefix from database errors ("STORE_CLOSED: …"). */
export function friendlyError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  const m = message.match(/^(STORE_CLOSED|INVALID|ITEM_UNAVAILABLE|MIN_ORDER|CLOSED|UNAVAILABLE|SIGN_IN|CASH_LOCKED):\s*(.*)$/s);
  if (m) return m[2];
  if (/fetch|network/i.test(message)) return "No connection. Please check your internet and try again.";
  return message;
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}
