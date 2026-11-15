import { StoresAdmin } from "@/components/admin/StoresAdmin";
import { requirePerm } from "@/lib/supabase/server";

export default async function Page() {
  await requirePerm("menu");
  return <StoresAdmin />;
}
