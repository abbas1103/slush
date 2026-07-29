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
    /* The four pills do not fit beside the wordmark below md, so the row scrolls
       sideways rather than being hidden - hiding it left /help and /tickets
       unreachable on a phone. The padding keeps focus rings clear of the
       scroll container's clip. */
    <nav
      aria-label="Your booking"
      className={cn(
        "mx-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain p-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "md:mx-0 md:flex-none md:overflow-visible md:p-0",
      )}
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 whitespace-nowrap text-[13px] font-medium transition-colors",
              // Same 44px coarse-pointer floor Button size="sm" takes. These pills
              // only became touch targets when the mobile nav was added, and at
              // py-1.5 they were about 31px. Desktop stays pixel-identical.
              "[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center",
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
