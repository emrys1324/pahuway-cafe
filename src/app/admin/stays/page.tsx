import { StaysAdmin } from "@/components/admin/StaysAdmin";
import { requirePerm } from "@/lib/supabase/server";

export default async function Page() {
  await requirePerm("rentals");
  return <StaysAdmin />;
}
