"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StoreHeader } from "@/components/customer/Header";
import { History, type MyBooking } from "@/components/customer/HistoryTabs";
import { PageLoader } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { getRecentOrders } from "@/lib/cart";
import { getRecentBooking } from "@/lib/rentals";
import { useStoreSettings } from "@/lib/store-settings";
import type { Order } from "@/lib/types";

/** Activity tab: the customer's café orders and scooter rentals. */
export function ActivityScreen() {
  const { settings, open } = useStoreSettings();
  const [data, setData] = useState<{ signedIn: boolean; orders: Order[]; bookings: MyBooking[] } | null>(null);
  const [guest, setGuest] = useState<{ order: { token: string; number: string } | null; booking: { token: string; number: string } | null }>({ order: null, booking: null });

  useEffect(() => {
    const r = getRecentOrders()[0];
    setGuest({ order: r ? { token: r.token, number: r.order_number } : null, booking: getRecentBooking() });
    const supabase = getSupabase();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setData({ signedIn: false, orders: [], bookings: [] });
      const [o, b] = await Promise.all([
        supabase.from("orders").select("*").eq("customer_id", auth.user.id).order("created_at", { ascending: false }).limit(30),
        supabase
          .from("rental_bookings")
          .select("id, booking_number, public_token, pickup_at, start_date, return_at, end_date, total, scooter_name, status")
          .eq("customer_user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      setData({ signedIn: true, orders: (o.data as Order[]) ?? [], bookings: (b.data as MyBooking[]) ?? [] });
    })();
  }, []);

  return (
    <div className="min-h-screen pb-6">
      <StoreHeader settings={settings} open={open} brand="site" />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
        <h1 className="font-display text-2xl font-bold">Activity</h1>
        {!data ? (
          <PageLoader />
        ) : data.signedIn ? (
          <History orders={data.orders} bookings={data.bookings} />
        ) : (
          <section className="card space-y-3 p-5" data-testid="activity-signin">
            <p className="text-coffee-800">Sign in to see all your orders and scooter rentals in one place.</p>
            {(guest.order || guest.booking) && (
              <div className="flex flex-wrap gap-2">
                {guest.order && (
                  <Link href={`/order/${guest.order.token}`} className="btn-secondary btn-sm">
                    Order {guest.order.number} →
                  </Link>
                )}
                {guest.booking && (
                  <Link href={`/baybayin/booking/${guest.booking.token}`} className="btn-secondary btn-sm">
                    Booking {guest.booking.number} →
                  </Link>
                )}
              </div>
            )}
            <Link href="/account?next=%2Factivity" className="btn-primary w-full">
              Sign in
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
