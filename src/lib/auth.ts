import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveCapabilities } from "@/lib/permissions";
import { VIEW_AS_COOKIE, parseViewAs } from "@/lib/viewAs";
import type { AccessLevel, CurrentUser } from "@/types";

/**
 * Who is signed in, verified from the session token itself.
 *
 * getClaims() checks the access token's signature against the project's public
 * signing key (fetched once, then cached in memory) and its expiry — locally,
 * with no request to Supabase. getUser() asked the auth server instead, which
 * put a full round trip in front of every page render and every API call.
 *
 * The one thing given up is noticing a session revoked server-side before its
 * access token expires (an hour at most). Postgres already accepts such a token
 * until then — RLS verifies the same signature the same way — so this matches
 * what the database enforces. If the project ever goes back to a shared-secret
 * signing key, getClaims() quietly falls back to asking the auth server.
 */
export async function getAuthUser(supabase: SupabaseClient): Promise<{ id: string } | null> {
  const { data, error } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (error || !id) return null;
  return { id };
}

/**
 * The signed-in user, resolved at most once per request.
 *
 * "Who is this and what may they do" needs the profile, the permission matrix
 * and the person's overrides. All three are read in a single parallel round
 * trip: the matrix is read for every tier (a small table) rather than the
 * caller's tier only, so nothing has to wait for the profile to come back
 * first. Every page waits on this before drawing, so it was worth collapsing —
 * it used to be three sequential round trips (auth server, profile, matrix).
 *
 * `cache()` scopes the result to the current request, so the layout, the page
 * and anything else rendering in the same request share one answer. It is
 * per-request only — nothing is held between requests, so a permission change
 * still takes effect on the very next navigation.
 *
 * Note this is *not* a security boundary. Every read and write is still checked
 * by RLS as the signed-in user; this only decides what the UI bothers to draw.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = createClient();

  const authUser = await getAuthUser(supabase);
  if (!authUser) return null;

  const [{ data: profile }, matrix, overrides, proposalAccess] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, name, avatar_url, role, is_admin, access_level")
      .eq("id", authUser.id)
      .single(),
    supabase.from("permissions").select("access_level, capability, allowed"),
    supabase.from("permission_overrides").select("capability, allowed").eq("user_id", authUser.id),
    // Same round trip as the rest. Errors (before migration 045) read as no access.
    supabase.from("proposal_access").select("role").eq("user_id", authUser.id).maybeSingle(),
  ]);

  if (!profile) return null;

  // "View as" (lib/viewAs.ts): a super admin previewing another tier gets that
  // tier's answer from here, so the nav, pages and controls all render as that
  // tier would see them. Only ever honoured for a real super admin — for anyone
  // else the cookie is ignored — and the middleware blocks writes while it's
  // set, so a preview can show less but never do more. The tier's own matrix
  // row is used, without this person's overrides: it previews the tier.
  const viewingAs = profile.access_level === "super_admin" ? parseViewAs(cookies().get(VIEW_AS_COOKIE)?.value) : null;
  const level: AccessLevel = viewingAs ?? profile.access_level;

  const capabilities = resolveCapabilities(
    level,
    matrix.error ? null : matrix.data || [],
    viewingAs ? null : overrides.data
  );

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    role: profile.role,
    isAdmin: viewingAs ? viewingAs === "admin" : profile.is_admin,
    accessLevel: level,
    isSuperAdmin: level === "super_admin",
    isClient: level === "client",
    // Mirrors the database rule (migration 029): clients are read-only.
    canEdit: level !== "client",
    capabilities,
    viewingAs,
    // Per person, so a tier preview has none — it previews the tier, not
    // anyone's individual grants (the same reason overrides are dropped above).
    proposalRole: viewingAs
      ? null
      : profile.access_level === "super_admin"
        ? "manager"
        : proposalAccess.data?.role === "manager" || proposalAccess.data?.role === "viewer"
          ? proposalAccess.data.role
          : null,
  };
});
