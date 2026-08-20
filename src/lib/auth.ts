import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { capabilitiesFor } from "@/lib/permissions";
import type { CurrentUser } from "@/types";

/**
 * The signed-in user, resolved at most once per request.
 *
 * Answering "who is this and what may they do" costs three round trips to
 * Supabase — the auth server, then `profiles`, then the permission matrix — and
 * every one of them has to finish before a page can build its real queries.
 * That chain was being paid several times over on a single navigation: the app
 * layout ran it, then the page ran it again, then each API route the page called
 * ran it once more.
 *
 * `cache()` scopes the result to the current request, so the second and third
 * callers get the first one's answer for free. It is per-request only — nothing
 * is held between requests, so a permission change still takes effect on the
 * very next navigation.
 *
 * Note this is *not* a security boundary. Every read and write is still checked
 * by RLS as the signed-in user; this only decides what the UI bothers to draw.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, avatar_url, role, is_admin, access_level")
    .eq("id", authUser.id)
    .single();

  if (!profile) return null;

  const capabilities = await capabilitiesFor(supabase, profile.access_level, profile.id);

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    role: profile.role,
    isAdmin: profile.is_admin,
    accessLevel: profile.access_level,
    isSuperAdmin: profile.access_level === "super_admin",
    isClient: profile.access_level === "client",
    // Mirrors the database rule (migration 029): clients are read-only.
    canEdit: profile.access_level !== "client",
    capabilities,
  };
});
