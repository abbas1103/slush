import type { Metadata } from "next";
import { TripCodeForm } from "@/components/booking/TripCodeForm";

export const metadata: Metadata = {
  title: "Enter your trip code - SLUSH",
  // Signed-in surface: never index it, and don't follow links out of it.
  robots: { index: false, follow: false },
};

export default function TripCodePage() {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-16">
      <TripCodeForm />
    </div>
  );
}
