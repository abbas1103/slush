/** Shared presentational helpers for the legal pages (privacy / terms). */

export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{children}</p>;
}

export function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-ink-2">
      {items.map((i, idx) => (
        <li key={idx}>{i}</li>
      ))}
    </ul>
  );
}

/** Bracketed placeholder that must be filled in before launch. */
export function Ph({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-chip px-1 font-medium text-ink">{children}</span>;
}

export function DraftNotice() {
  return (
    <div className="mb-6 rounded-btn border border-line bg-chip px-4 py-3 text-[13px] text-ink-2">
      <strong>Draft — pending legal review.</strong> This is a working template.
      It must be reviewed by a qualified adviser and the bracketed details
      completed before SLUSH takes real bookings.
    </div>
  );
}
