/**
 * "Sat 12 – Sat 19 December 2026" from two YYYY-MM-DD strings. The compact form
 * (one month/year, at the end) is only correct when both ends share a month AND
 * a year: a New Year trip must read "Mon 28 December 2026 – Mon 4 January 2027",
 * never "Mon 28 – Mon 4 January 2027", which puts departure a month late.
 */
export function formatDateRange(startISO: string, endISO: string): string {
  const s = new Date(`${startISO}T00:00:00`);
  const e = new Date(`${endISO}T00:00:00`);
  const wd = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });
  const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const start = sameMonth ? `${wd(s)} ${s.getDate()}` : `${wd(s)} ${s.getDate()} ${monthYear(s)}`;
  return `${start} – ${wd(e)} ${e.getDate()} ${monthYear(e)}`;
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
