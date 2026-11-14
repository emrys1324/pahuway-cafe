import { Suspense } from "react";
import { ExploreScreen } from "./ExploreScreen";

export const metadata = { title: "Explore — Padaya" };

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreScreen />
    </Suspense>
  );
}
