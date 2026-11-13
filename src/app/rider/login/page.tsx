import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/supabase/server";
import { RiderLoginForm } from "./RiderLoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rider sign in — Padaya" };

export default async function RiderLoginPage() {
  const session = await getSessionRole();
  if (session?.role === "rider") redirect("/rider"); // already signed in → straight to deliveries
  return (
    <Suspense>
      <RiderLoginForm />
    </Suspense>
  );
}
