import { StayRoomScreen } from "@/components/stays/StayRoomScreen";

export const metadata = { title: "Book a stay — Padaya" };

export default async function StayRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StayRoomScreen id={id} />;
}
