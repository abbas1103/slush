/** "Sat 12 – Sat 19 December 2026" from two YYYY-MM-DD strings. */
export function formatDateRange(startISO: string, endISO: string): string {
  const s = new Date(`${startISO}T00:00:00`);
  const e = new Date(`${endISO}T00:00:00`);
  const wd = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });
  const monthYear = e.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return `${wd(s)} ${s.getDate()} – ${wd(e)} ${e.getDate()} ${monthYear}`;
}

/** "15 Nov 2026" from a YYYY-MM-DD string. */
export function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
