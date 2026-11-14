"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Spinner } from "@/components/ui";
import { getAuthedSupabase, getSupabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import { formatTime } from "@/lib/hours";

interface ChatMessage {
  id: string;
  sender: "customer" | "rider";
  body: string;
  created_at: string;
}

/**
 * Live chat between the customer and the assigned rider on a delivery order.
 * `canSend` is false until a rider is assigned, and again once the order is completed or cancelled.
 */
export function OrderChat({ orderId, me, canSend, closedNote, otherName }: { orderId: string; me: "customer" | "rider"; canSend: boolean; closedNote?: string; otherName?: string | null }) {
  const [list, setList] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;
    const load = async () => {
      const { data } = await getSupabase().from("order_messages").select("id, sender, body, created_at").eq("order_id", orderId).order("created_at");
      if (alive) setList((data as ChatMessage[]) ?? []);
    };
    load();
    getAuthedSupabase().then((sb) => {
      if (!alive) return;
      const ch = sb
        .channel(`order-chat-${orderId}-${me}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` }, load)
        .subscribe();
      cleanup = () => sb.removeChannel(ch);
    });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [orderId, me]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [list?.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    const { data, error } = await getSupabase().rpc("send_order_message", { p_order_id: orderId, p_body: body });
    setBusy(false);
    if (error) return setError(friendlyError(error.message));
    setText("");
    const m = data as ChatMessage;
    setList((l) => (l && !l.some((x) => x.id === m.id) ? [...l, m] : l));
  };

  const them = me === "customer" ? otherName || "Rider" : otherName || "Customer";
  return (
    <section className="card space-y-3 p-4" id="chat" data-testid="order-chat">
      <h2 className="section-title">{me === "customer" ? `Chat with ${otherName ? otherName + " (rider)" : "your rider"}` : `Chat with ${them}`}</h2>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl bg-coffee-50 p-3" data-testid="chat-messages" aria-live="polite">
        {list === null ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="py-3 text-center text-sm text-coffee-600">{canSend ? "No messages yet. Say hi!" : closedNote ?? "No messages."}</p>
        ) : (
          list.map((m) => {
            const mine = m.sender === me;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="chat-message" data-mine={mine || undefined}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "rounded-br-sm bg-coffee-700 text-cream" : "rounded-bl-sm bg-white text-coffee-900 shadow-sm"}`}>
                  {!mine && <p className="text-xs font-bold text-coffee-600">{them}</p>}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[11px] ${mine ? "text-cream/70" : "text-coffee-500"}`}>{formatTime(m.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>
      {error && <Alert>{error}</Alert>}
      {canSend ? (
        <form onSubmit={send} className="flex gap-2">
          <input
            className="input flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder={me === "customer" ? "Message your rider…" : "Message the customer…"}
            aria-label="Message"
          />
          <button className="btn-primary px-4" disabled={busy || !text.trim()} aria-label="Send">
            {busy ? <Spinner /> : "Send"}
          </button>
        </form>
      ) : (
        closedNote && list && list.length > 0 && <p className="text-center text-sm text-coffee-600">{closedNote}</p>
      )}
    </section>
  );
}
