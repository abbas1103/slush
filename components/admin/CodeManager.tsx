"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addTripCode, setTripCodeActive } from "@/app/admin/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";

interface Code { id: string; code: string; active: boolean }

export function CodeManager({ tripId, codes }: { tripId: string; codes: Code[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!code.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await addTripCode(tripId, code);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setCode("");
    router.refresh();
  }
  async function toggle(id: string, active: boolean) {
    await setTripCodeActive(id, tripId, active);
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="text-[13px] font-semibold">Trip codes</div>
      <div className="flex flex-col gap-2">
        {codes.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
            <span className="font-mono text-[14px]">{c.code}</span>
            <div className="flex items-center gap-2">
              <Pill variant={c.active ? "success" : "tag"} dot={c.active}>{c.active ? "active" : "inactive"}</Pill>
              <Button size="sm" variant="out" onClick={() => toggle(c.id, !c.active)}>
                {c.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </div>
        ))}
        {codes.length === 0 && <p className="text-[13px] text-soft">No codes yet.</p>}
      </div>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NEW-CODE-26" className="flex-1" />
        <Button variant="out" onClick={add} disabled={busy}>Add code</Button>
      </div>
      {err && <p className="text-[13px] text-err">{err}</p>}
    </Card>
  );
}
