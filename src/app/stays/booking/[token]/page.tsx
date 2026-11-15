import { StayBookingScreen } from "@/components/stays/StayBookingScreen";

export const metadata = { title: "Your stay — Padaya" };

export default async function StayBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StayBookingScreen token={token} />;
}
