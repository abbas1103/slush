import Link from "next/link";

type Item = string | { label: string; href: string };

function FooterCol({ title, items }: { title: string; items: Item[] }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-white">{title}</div>
      <ul className="mt-3 flex flex-col gap-2 text-[13px] text-white/60">
        {items.map((i) => {
          const label = typeof i === "string" ? i : i.label;
          return (
            <li key={label}>
              {typeof i === "string" ? (
                label
              ) : (
                <Link href={i.href} className="hover:text-white">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Dark 4-column footer (Book / Help / Legal), matching the prototype. */
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
        <FooterCol title="Book" items={["Ski trips", "Lift passes", "Equipment hire"]} />
        <FooterCol title="Help" items={["Contact us", "Manage booking", "Travel info"]} />
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
