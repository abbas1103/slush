"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/tickets", label: "Tickets" },
  { href: "/account", label: "My details" },
  { href: "/help", label: "Help" },
];

export function NavPills() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-ink text-white" : "text-soft hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
