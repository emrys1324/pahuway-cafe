import { ToursAdmin } from "@/components/admin/ToursAdmin";
import { requirePerm } from "@/lib/supabase/server";

export default async function Page() {
  await requirePerm("rentals");
  return <ToursAdmin />;
}
