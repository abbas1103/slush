import type { MetadataRoute } from "next";

/**
 * Only the public marketing page and the legal pages are crawlable. Everything
 * that sits behind a login (the booking flow, the dashboard, tickets, the CMS)
 * is disallowed: a real trip's booking flow and its sign-in pages have no place
 * in search results. Signed-in pages also send `robots: noindex` themselves -
 * robots.txt is the belt, the meta tag is the braces.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/account",
          "/admin",
          "/api/",
          "/auth/",
          "/book",
          "/dashboard",
          "/help",
          "/login",
          "/monitoring",
          "/reset",
          "/signup",
          "/tickets",
          "/trip",
          "/verify-email",
        ],
      },
    ],
  };
}
