import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPABILITIES } from "@/lib/capabilities";
import type { AccessLevel } from "@/types";

const ALL = CAPABILITIES.map((c) => c.key as string);

type CapabilityRow = { capability: string; allowed: boolean };

/**
 * The capability list from matrix rows already read — the part of
 * capabilitiesFor that doesn't touch the database, shared with getCurrentUser
 * (lib/auth.ts), which reads the rows alongside the profile in one round trip.
 *
 * `matrix` may hold every tier's rows; only `accessLevel`'s count. A null
 * `matrix` means the table couldn't be read.
 */
export function resolveCapabilities(
  accessLevel: AccessLevel | null | undefined,
  matrix: (CapabilityRow & { access_level?: string })[] | null,
  overrides: CapabilityRow[] | null
): string[] {
  if (!accessLevel) return [];
  // The super admin is never gated, matching has_permission().
  if (accessLevel === "super_admin") return ALL;

  // Before migration 032 the table doesn't exist. Falling back to "everything"
  // keeps the app usable in that window — the database is still enforcing the
  // pre-matrix rules, so controls that shouldn't work simply error on save
  // rather than silently vanishing for every tier at once.
  if (!matrix) return ALL;

  const granted = new Set(
    matrix
      .filter((r) => r.allowed && (r.access_level ?? accessLevel) === accessLevel)
      .map((r) => r.capability)
  );

  // Per-person overrides (033) win over the tier, in both directions: a row
  // with allowed = false is a real deny, which is why this can't just union.
  for (const row of overrides || []) {
    if (row.allowed) granted.add(row.capability);
    else granted.delete(row.capability);
  }

  return [...granted];
}

/**
 * The capabilities a tier holds, read from the permission matrix.
 *
 * This is the same answer `has_permission()` gives in SQL, resolved once per
 * request so the UI can decide what to render. It is *not* the enforcement —
 * every write still passes through the policies and the trigger, so a stale or
 * tampered list here changes what you see, never what you can do.
 */
export async function capabilitiesFor(
  supabase: SupabaseClient,
  accessLevel: AccessLevel | null | undefined,
  userId?: string | null
): Promise<string[]> {
  if (!accessLevel) return [];
  // The super admin is never gated, matching has_permission().
  if (accessLevel === "super_admin") return ALL;

  // Both at once. The overrides don't depend on the tier's answer — they're
  // applied on top of it — so awaiting them in sequence just added a second
  // round trip to a chain that every page waits on before it can start its own
  // queries.
  const [{ data, error }, overrideResult] = await Promise.all([
    supabase.from("permissions").select("capability, allowed").eq("access_level", accessLevel),
    userId
      ? supabase.from("permission_overrides").select("capability, allowed").eq("user_id", userId)
      : Promise.resolve({ data: null }),
  ]);

  return resolveCapabilities(accessLevel, error ? null : data || [], overrideResult.data);
}
