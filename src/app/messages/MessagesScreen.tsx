"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { PageLoader } from "@/components/ui";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { useStoreSettings } from "@/lib/store-settings";

interface Message {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

/** Messages tab: automatic updates about the customer's orders and bookings. Opening it marks them read. */
export function MessagesScreen() {
  const { settings, open } = useStoreSettings();
  const [list, setList] = useState<Message[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setSignedIn(false);
      setSignedIn(true);
      const load = async () => {
        const { data: rows } = await supabase.from("customer_messages").select("id, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(50);
        if (!alive) return;
        setList((rows as Message[]) ?? []);
        if ((rows ?? []).some((r) => !r.read_at)) {
          await supabase.rpc("mark_messages_read");
          window.dispatchEvent(new Event("inbox-read"));
        }
      };
      await load();
      const authed = await getAuthedSupabase();
      const ch = authed
        .channel(`inbox-page-${data.user.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_messages", filter: `user_id=eq.${data.user.id}` }, load)
        .subscribe();
      cleanup = () => authed.removeChannel(ch);
    })();
    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
        <h1 className="font-display text-2xl font-bold">Messages</h1>
        {signedIn === false ? (
          <section className="card space-y-3 p-5" data-testid="messages-signin">
            <p className="text-coffee-800">Sign in to get updates here when your order is ready or your scooter booking is confirmed.</p>
            <Link href="/account?next=%2Fmessages" className="btn-primary w-full">
              Sign in
            </Link>
          </section>
        ) : !list ? (
          <PageLoader />
        ) : list.length === 0 ? (
          <section className="card p-5 text-coffee-700" data-testid="messages-empty">
            No messages yet. Updates about your orders and scooter bookings will show up here.
          </section>
        ) : (
          <ul className="card divide-y divide-coffee-100 overflow-hidden" data-testid="messages-list">
            {list.map((m) => {
              const inner = (
                <div className="flex gap-3 p-4">
                  <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${m.read_at ? "bg-transparent" : "bg-red-600"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`${m.read_at ? "font-semibold" : "font-bold"} text-coffee-900`}>
                      {m.title}
                      {!m.read_at && <span className="sr-only"> (new)</span>}
                    </p>
                    {m.body && <p className="text-sm text-coffee-700">{m.body}</p>}
                    <p className="mt-1 text-xs text-coffee-500">{timeAgo(m.created_at)}</p>
                  </div>
                  {m.link && (
                    <span aria-hidden className="self-center text-coffee-400">
                      →
                    </span>
                  )}
                </div>
              );
              return (
                <li key={m.id} data-testid="message" data-unread={!m.read_at || undefined}>
                  {m.link ? (
                    <Link href={m.link} className="block hover:bg-coffee-50">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
