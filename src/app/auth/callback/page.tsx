import { Suspense } from "react";
import { AuthCallback } from "./AuthCallback";

export const metadata = { title: "Signing in — Padaya" };

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  );
}
