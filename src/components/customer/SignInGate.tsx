"use client";
import Link from "next/link";
import { GoogleButton } from "./GoogleButton";

/** Shown instead of the checkout / booking form when customers must have an account. */
export function SignInGate({ next, what }: { next: string; what: "order" | "book" }) {
  const href = (mode: "signin" | "signup") => `/account?next=${encodeURIComponent(next)}${mode === "signup" ? "&mode=signup" : ""}`;
  return (
    <section className="card space-y-4 p-5" data-testid="signin-gate">
      <div>
        <h2 className="font-display text-xl font-bold">Sign in to {what === "order" ? "order" : "book"}</h2>
        <p className="text-coffee-700">
          {what === "order"
            ? "Please sign in or create a free account to place your order. Your details are filled in for you next time, and you can see your orders anytime."
            : "Please sign in or create a free account to book a scooter. You can see your bookings anytime under My account."}
        </p>
      </div>
      <GoogleButton next={next} />
      <div className="flex items-center gap-3 text-sm text-coffee-600">
        <span className="h-px flex-1 bg-coffee-200" /> or <span className="h-px flex-1 bg-coffee-200" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href={href("signin")} className="btn-primary">
          Sign in
        </Link>
        <Link href={href("signup")} className="btn-secondary">
          Create account
        </Link>
      </div>
    </section>
  );
}
