"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { safeNext } from "@/lib/google-signin";

/** Google (and other sign-in links) land here, finish signing in, then go back to where the customer was. */
export function AuthCallback() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = safeNext(params.get("next"));
    const failed = params.get("error_description") ?? params.get("error");
    if (failed) return setError(failed.replace(/\+/g, " "));
    let done = false;
    const supabase = getSupabase();
    const go = () => {
      if (done) return;
      done = true;
      window.location.replace(next);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => session && go());
    (async () => {
      // the client may already have exchanged the code by itself
      const { data } = await supabase.auth.getSession();
      if (data.session) return go();
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) return go();
        const again = await supabase.auth.getSession();
        if (again.data.session) return go();
        setError("This sign-in link has expired. Please try again.");
      } else {
        setTimeout(async () => {
          const { data } = await supabase.auth.getSession();
          if (data.session) go();
          else setError("We couldn't finish signing you in. Please try again.");
        }, 4000);
      }
    })();
    return () => sub.subscription.unsubscribe();
  }, [params]);

  if (!error) return <PageLoader />;
  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <Alert>{error}</Alert>
      <Link href="/account" className="btn-primary w-full">
        Back to sign in
      </Link>
    </main>
  );
}
