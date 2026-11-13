import { Suspense } from "react";
import { AccountScreen } from "./AccountScreen";

export const metadata = { title: "My account — Padaya" };

export default function AccountPage() {
  return (
    <Suspense>
      <AccountScreen />
    </Suspense>
  );
}
