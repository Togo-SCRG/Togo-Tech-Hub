import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { VIEW_AS_COOKIE, parseViewAs } from "@/lib/viewAs";

// Long enough for a review session, short enough that a forgotten preview
// doesn't leave someone puzzling over a read-only app the next morning.
const MAX_AGE_SECONDS = 4 * 60 * 60;

/**
 * Start previewing the app as another access level. Super admin only.
 *
 * The check here is about who may switch the preview on; it isn't what makes
 * the preview safe. That's getCurrentUser() ignoring the cookie for anyone but
 * a super admin, and the middleware refusing writes while it's set.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The real tier, read directly: getCurrentUser() would already report the
  // previewed one if a preview is running, and switching tiers mid-preview is
  // allowed.
  const { data: profile } = await supabase.from("profiles").select("access_level").eq("id", user.id).single();
  if (profile?.access_level !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can preview other access levels." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const level = parseViewAs(body.level);
  if (!level) {
    return NextResponse.json({ error: "Choose admin, user or client." }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, viewingAs: level });
  res.cookies.set(VIEW_AS_COOKIE, level, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

/** Stop previewing. Open to anyone signed in — clearing it only ever restores access. */
export async function DELETE() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, viewingAs: null });
  res.cookies.delete(VIEW_AS_COOKIE);
  return res;
}
