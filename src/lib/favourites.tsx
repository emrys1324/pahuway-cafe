"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export type FavKind = "menu_item" | "scooter" | "car" | "stay" | "tour";
interface FavCtx {
  signedIn: boolean | undefined;
  has: (kind: FavKind, id: string) => boolean;
  toggle: (kind: FavKind, id: string) => Promise<"added" | "removed" | "signin">;
  list: { kind: FavKind; item_id: string }[];
}
const Ctx = createContext<FavCtx | null>(null);
const key = (k: string, id: string) => `${k}:${id}`;

/** Saved listings (♡) for the signed-in customer. */
export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [list, setList] = useState<{ kind: FavKind; item_id: string }[]>([]);
  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data: auth } = await supabase.auth.getUser();
    setSignedIn(!!auth.user);
    if (!auth.user) return setList([]);
    const { data } = await supabase.from("favourites").select("kind, item_id").order("created_at", { ascending: false });
    setList((data as { kind: FavKind; item_id: string }[]) ?? []);
  }, []);
  useEffect(() => {
    load();
    const { data: sub } = getSupabase().auth.onAuthStateChange(() => load());
    return () => sub.subscription.unsubscribe();
  }, [load]);
  const has = useCallback((kind: FavKind, id: string) => list.some((f) => key(f.kind, f.item_id) === key(kind, id)), [list]);
  const toggle = useCallback(
    async (kind: FavKind, id: string) => {
      const supabase = getSupabase();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return "signin" as const;
      if (list.some((f) => f.kind === kind && f.item_id === id)) {
        setList((l) => l.filter((f) => !(f.kind === kind && f.item_id === id)));
        await supabase.from("favourites").delete().eq("kind", kind).eq("item_id", id);
        return "removed" as const;
      }
      setList((l) => [{ kind, item_id: id }, ...l]);
      await supabase.from("favourites").insert({ user_id: auth.user.id, kind, item_id: id });
      return "added" as const;
    },
    [list],
  );
  return <Ctx.Provider value={{ signedIn, has, toggle, list }}>{children}</Ctx.Provider>;
}

export function useFavourites(): FavCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFavourites must be used inside FavouritesProvider");
  return c;
}
