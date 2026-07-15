import { Card } from "@/components/ui/Card";

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <h1>Help</h1>
      <Card className="mt-6">
        <p className="text-[14px] text-ink-2">
          Need a hand with your booking? Contact your trip organiser, or email the SLUSH team. A full
          help centre and in-resort support details arrive before launch.
        </p>
      </Card>
    </div>
  );
}
