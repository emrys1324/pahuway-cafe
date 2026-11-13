"use client";
import { getSupabase } from "@/lib/supabase/client";

/** Only same-site paths are allowed as a return address (no "//evil.com"). */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Sends the customer to Google; they come back to /auth/callback and then to `next`. */
export async function signInWithGoogle(next: string): Promise<string | null> {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
  const { error } = await getSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (!error) return null;
  return /provider is not enabled|unsupported provider/i.test(error.message)
    ? "Google sign-in isn't set up yet. Please use your mobile number or email for now."
    : error.message;
}
