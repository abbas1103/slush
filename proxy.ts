import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a logged-in session
const PROTECTED = ['/dashboard', '/book', '/trip', '/account', '/tickets']
// Admin area: requires a logged-in ADMIN (role in JWT app_metadata)
const ADMIN = ['/admin']
// Routes that logged-in users should be bounced away from
const AUTH_ONLY = ['/login', '/signup']

/**
 * Content-Security-Policy, built per request. In PRODUCTION a fresh nonce is
 * minted and `'unsafe-inline'` is dropped from script-src (audit #13) — Next
 * injects the nonce into its own <script> tags when it sees a nonce in the
 * request's CSP header, and Stripe/Turnstile stay host-allowlisted. In DEV we
 * keep `'unsafe-inline'` + `'unsafe-eval'` (Turbopack/React HMR need them) and
 * mint no nonce (a nonce would make browsers ignore 'unsafe-inline').
 */
function buildCsp(nonce: string | null): string {
  const isDev = process.env.NODE_ENV !== 'production'
  const scriptSrc = [
    "script-src 'self'",
    nonce ? `'nonce-${nonce}'` : '',
    isDev ? "'unsafe-inline' 'unsafe-eval'" : '',
    'https://js.stripe.com https://challenges.cloudflare.com',
  ]
    .filter(Boolean)
    .join(' ')

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://challenges.cloudflare.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export default async function proxy(request: NextRequest) {
  // Per-request nonce (prod only). btoa/crypto are Edge-runtime globals — no Buffer.
  const nonce =
    process.env.NODE_ENV === 'production' ? btoa(crypto.randomUUID()) : null
  const csp = buildCsp(nonce)

  // Request headers carrying the CSP (+nonce) so Next can nonce its own scripts,
  // rebuilt from `request` so it always includes cookies mutated below.
  const reqHeaders = () => {
    const h = new Headers(request.headers)
    h.set('content-security-policy', csp)
    if (nonce) h.set('x-nonce', nonce)
    return h
  }

  // Fresh response threading cookies so Supabase can refresh an expiring session.
  let response = NextResponse.next({ request: { headers: reqHeaders() } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mirror cookies onto the request so Server Components see them, then
          // rebuild the response from the (now cookie-updated) request headers.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request: { headers: reqHeaders() } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() also refreshes the session token when close to expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const role = (user?.app_metadata as { role?: string } | undefined)?.role

  // Attach the CSP header to whatever response we ultimately return.
  const finalize = (res: NextResponse) => {
    res.headers.set('content-security-policy', csp)
    return res
  }

  // Admin area: must be a logged-in admin. Non-admins are sent home rather than
  // shown that /admin exists. (Guards re-check server-side; never trust this alone.)
  if (ADMIN.some((r) => pathname.startsWith(r))) {
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return finalize(NextResponse.redirect(loginUrl))
    }
    if (role !== 'admin') {
      return finalize(NextResponse.redirect(new URL('/', request.url)))
    }
    return finalize(response)
  }

  // Authenticated user hitting a login/signup page → send home
  if (user && AUTH_ONLY.some((r) => pathname.startsWith(r))) {
    return finalize(NextResponse.redirect(new URL('/', request.url)))
  }

  // Unauthenticated user hitting a protected page → send to login, preserve destination
  if (!user && PROTECTED.some((r) => pathname.startsWith(r))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return finalize(NextResponse.redirect(loginUrl))
  }

  return finalize(response)
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
