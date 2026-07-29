"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkIn } from "@/app/scan/[token]/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import type { ScanOutcome } from "@/lib/db/tickets";

interface Props {
  token: string;
  outcome: ScanOutcome;
  ticket: {
    ticketId: string;
    ticketType: string;
    title: string;
    maxScans: number;
    reference: string;
    studentName: string;
    tripName: string;
    bookingStatus: string;
    scans: { at: string; result: string }[];
  };
}

const HEADLINE: Record<ScanOutcome, { text: string; tone: "ok" | "warn" | "bad" }> = {
  ok: { text: "Valid - let them through", tone: "ok" },
  duplicate: { text: "Already used", tone: "warn" },
  not_entitled: { text: "Not valid for travel", tone: "bad" },
  revoked: { text: "Ticket cancelled", tone: "bad" },
  unknown_token: { text: "Not recognised", tone: "bad" },
};

const TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-okbg text-ok",
  warn: "bg-errbg text-err",
  bad: "bg-panel text-white",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ScanResult({ token, outcome, ticket }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ScanOutcome | null>(null);

  const used = ticket.scans.filter((s) => s.result === "ok").length;
  const head = HEADLINE[done ?? outcome];

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const r = await checkIn(token);
      if (!r.ok) return setErr(r.error);
      setDone(r.outcome);
      router.refresh();
    } catch {
      setErr("Couldn't record that. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-4 px-5 py-6">
      {/* Big and colour-coded: this is read at arm's length at a coach door. */}
      <div className={`rounded-card p-5 text-center ${TONE[head.tone]}`}>
        <div className="text-[22px] font-extrabold">{head.text}</div>
        {(done ?? outcome) === "duplicate" && (
          <div className="mt-1 text-[13px]">
            Scanned {used} of {ticket.maxScans} allowed
            {ticket.scans[0] ? ` - last at ${when(ticket.scans[0].at)}` : ""}
          </div>
        )}
        {(done ?? outcome) === "not_entitled" && (
          <div className="mt-1 text-[13px]">Booking is {ticket.bookingStatus}</div>
        )}
      </div>

      <Card className="flex flex-col gap-3">
        {/* Minimal by design: enough to match person to ticket, and nothing more.
            No passport, no date of birth, no medical needs. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-soft">Student</div>
          <div className="text-[19px] font-bold">{ticket.studentName}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-soft">Ticket</div>
            <div className="text-[15px] font-semibold">{ticket.ticketType}</div>
            <div className="text-[12.5px] text-soft">{ticket.title}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-soft">Reference</div>
            <div className="font-mono text-[14px]">{ticket.reference}</div>
            <div className="text-[12.5px] text-soft">{ticket.tripName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line-2 pt-3">
          <Pill variant={used < ticket.maxScans ? "success" : "error"}>
            {used}/{ticket.maxScans} used
          </Pill>
          <span className="font-mono text-[11px] text-soft">{ticket.ticketId}</span>
        </div>
      </Card>

      {done === null ? (
        <Button className="w-full" onClick={confirm} disabled={busy}>
          {busy ? "Recording…" : outcome === "ok" ? "Check in" : "Record this scan anyway"}
        </Button>
      ) : (
        <div className="rounded-btn border border-line bg-soft-panel px-4 py-3 text-center text-[13px] text-soft">
          Recorded. Scan the next ticket.
        </div>
      )}
      {/* Refusals are recorded too - a refunded ticket being presented is exactly
          what an organiser wants to know about afterwards. */}
      {outcome !== "ok" && done === null && (
        <p className="text-center text-[12px] text-soft">
          Recording it leaves a trail even though the ticket isn&apos;t valid.
        </p>
      )}
      {err && (
        <p role="alert" className="text-center text-[13px] text-err">
          {err}
        </p>
      )}

      {ticket.scans.length > 0 && (
        <Card className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">Scan history</div>
          {ticket.scans.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-[12.5px]">
              <span className="text-soft">{when(s.at)}</span>
              <Pill variant={s.result === "ok" ? "success" : "error"}>{s.result}</Pill>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
