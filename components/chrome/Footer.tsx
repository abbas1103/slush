import Link from "next/link";

/** Every footer item is a link - text styled like a link but with no
 *  destination is indistinguishable from a real one on touch. */
type Item = { label: string; href: string };

function FooterCol({ title, items }: { title: string; items: Item[] }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-white">{title}</div>
      <ul className="mt-3 flex flex-col gap-2 text-[13px] text-white/60">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="hover:text-white">
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Dark 4-column footer (Book / Help / Legal), matching the prototype's layout.
 * The prototype's marketing items (Lift passes, Equipment hire, Travel info)
 * are dropped until those pages exist - they are extras chosen inside the
 * booking flow, not destinations.
 */
export function Footer() {
  return (
    <footer className="mt-16 bg-panel text-white">
      <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[18px] font-extrabold">SLUSH</div>
          <p className="mt-3 max-w-xs text-[13px] text-white/60">
            Student Led Uni Ski Holidays. Trips run in partnership with
            university snowsports societies.
          </p>
        </div>
        <FooterCol title="Book" items={[{ label: "Enter a trip code", href: "/trip" }]} />
        <FooterCol
          title="Help"
          items={[
            { label: "Get help", href: "/help" },
            { label: "Manage booking", href: "/dashboard" },
          ]}
        />
        <FooterCol
          title="Legal"
          items={[
            { label: "Privacy & cookies", href: "/privacy" },
            { label: "Terms & conditions", href: "/terms" },
            { label: "Booking conditions", href: "/terms#booking" },
          ]}
        />
      </div>
    </footer>
  );
}
