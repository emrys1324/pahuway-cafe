import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MenuScreen } from "@/components/customer/MenuScreen";
import { PageLoader } from "@/components/ui";

export const metadata = { title: "Menu — Padaya" };

export default async function StoreMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === "pahuway-cafe") redirect("/menu");
  return (
    <Suspense fallback={<PageLoader />}>
      <MenuScreen slug={slug} />
    </Suspense>
  );
}
