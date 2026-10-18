import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { VIEW_AS_COOKIE, VIEW_AS_READ_ONLY_MESSAGE, parseViewAs } from "@/lib/viewAs";

export const config = {
  // Excludes Next internals, the login page, and any request for a static
  // file (images/fonts/etc. under public/) — those need to load even when
  // signed out, e.g. the logo on the login page itself.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|login|.*\\.[\\w]+$).*)"],
};

export async function middleware(request: NextRequest) {
  // API routes authenticate themselves: every handler under app/api calls
  // getAuthUser() (or getCurrentUser()) from lib/auth.ts and returns 401
  // without a user, and route handlers can write cookies, so they refresh an
  // expired session on their own. Verifying here as well cost one extra Supabase round
  // trip on every API call — and the pages that load in the browser make
  // several per visit. Only a cheap "is there a session cookie at all" gate is
  // kept, so anonymous requests are still turned away before reaching a route.
  //
  // This makes the per-route check load-bearing: a new API route MUST verify
  // the user itself.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const hasSessionCookie = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
    if (!hasSessionCookie) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // "View as" previews are read-only (lib/viewAs.ts). Previewing as a user
    // while actually being the super admin means any save would run with the
    // super admin's powers, not the previewed tier's — so nothing saves. The
    // cookie isn't verified here, and needn't be: it can only stop writes, so
    // setting it by hand only locks yourself out of saving. /api/view-as stays
    // open so the preview can be switched or ended.
    const previewing = parseViewAs(request.cookies.get(VIEW_AS_COOKIE)?.value);
    const isWrite = request.method !== "GET" && request.method !== "HEAD";
    if (previewing && isWrite && request.nextUrl.pathname !== "/api/view-as") {
      return NextResponse.json({ error: VIEW_AS_READ_ONLY_MESSAGE, preview: true }, { status: 403 });
    }

    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // getClaims, not getUser: the token is verified locally against the
  // project's signing key rather than by a round trip to the auth server, which
  // every navigation and prefetch used to wait on. It still refreshes an
  // expiring session, which is this middleware's other job. See getAuthUser in
  // lib/auth.ts for what local verification does and doesn't cover.
  const { data: auth } = await supabase.auth.getClaims();

  if (!auth?.claims?.sub) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
