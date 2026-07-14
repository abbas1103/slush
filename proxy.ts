import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a logged-in session
const PROTECTED = ['/dashboard', '/book', '/trip', '/account', '/tickets']
// Admin area: requires a logged-in ADMIN (role in JWT app_metadata)
const ADMIN = ['/admin']
// Routes that logged-in users should be bounced away from
const AUTH_ONLY = ['/login', '/signup']

export default async function proxy(request: NextRequest) {
  // We must create a fresh response and thread cookies through it so the
  // Supabase client can refresh an expiring session on every request.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mirror cookies onto the request so Server Components see them
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          // Re-create the response so we can set cookies on it too
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() also refreshes the session token when it is close to expiry.
  // Must be called before any redirect decisions.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const role = (user?.app_metadata as { role?: string } | undefined)?.role

  // Admin area: must be a logged-in admin. Non-admins are sent home rather than
  // shown that /admin exists. (Guards re-check server-side; never trust this alone.)
  if (ADMIN.some(r => pathname.startsWith(r))) {
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return response
  }

  // Authenticated user hitting a login/signup page → send home
  if (user && AUTH_ONLY.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Unauthenticated user hitting a protected page → send to login, preserve destination
  if (!user && PROTECTED.some(r => pathname.startsWith(r))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
