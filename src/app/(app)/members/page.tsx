import { createClient } from "@/lib/supabase/server";
import { MembersView } from "@/components/members/MembersView";
import { compareByRole } from "@/lib/utils";
import type { AccessLevel } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  access_level: AccessLevel;
  invited_at?: string | null;
  signed_in_at?: string | null;
}

/** What the page actually needs per person — see migration 042. */
export interface MemberStats {
  total: number;
  completed: number;
  projects: string[];
}

const EMPTY_STATS: MemberStats = { total: 0, completed: 0, projects: [] };

/**
 * Per-member update counts, from the database where possible.
 *
 * The view (migration 042) returns one row per member. Until that migration has
 * been run by hand in the SQL Editor, this falls back to what the page used to
 * do — read every update and group them here — so the page keeps working in the
 * window where deployed code is ahead of the database. The fallback is the slow
 * path on purpose: it's correct, and it stops being used the moment 042 lands.
 */
async function fetchMemberStats(supabase: SupabaseClient): Promise<Map<string, MemberStats>> {
  const byUser = new Map<string, MemberStats>();

  const { data: rollup, error } = await supabase
    .from("member_update_stats")
    .select("user_id, update_count, completed_count, projects");

  if (!error) {
    for (const row of rollup || []) {
      byUser.set(row.user_id, {
        total: row.update_count ?? 0,
        completed: row.completed_count ?? 0,
        projects: row.projects || [],
      });
    }
    return byUser;
  }

  const { data: updates } = await supabase.from("daily_updates").select("user_id, project, status");
  for (const u of updates || []) {
    const entry = byUser.get(u.user_id) || { total: 0, completed: 0, projects: [] as string[] };
    entry.total += 1;
    if (u.status === "Completed") entry.completed += 1;
    if (u.project && !entry.projects.includes(u.project)) entry.projects.push(u.project);
    byUser.set(u.user_id, entry);
  }
  return byUser;
}

/**
 * The team roster.
 *
 * invited_at/signed_in_at arrive with migration 018; fall back to the base
 * columns so the page still renders before it's been run.
 */
async function fetchProfiles(supabase: SupabaseClient): Promise<ProfileRow[]> {
  const BASE_COLUMNS = "id, name, avatar_url, role, access_level";
  const withInvite = await supabase
    .from("profiles")
    .select(`${BASE_COLUMNS}, invited_at, signed_in_at`)
    .neq("access_level", "client");

  if (withInvite.data) return withInvite.data as ProfileRow[];

  const fallback = await supabase.from("profiles").select(BASE_COLUMNS).neq("access_level", "client");
  return (fallback.data as ProfileRow[] | null) ?? [];
}

export default async function MembersPage() {
  const supabase = createClient();

  // Concurrent: the roster and the counts don't depend on each other. These
  // used to be two sequential awaits, which meant the page waited out both
  // round trips end to end before it could render anything.
  const [profiles, statsByUser] = await Promise.all([
    fetchProfiles(supabase),
    fetchMemberStats(supabase),
  ]);

  const members = profiles
    .map((p) => ({
      ...p,
      // Invited but never signed in. Seeded accounts have no invited_at, so
      // they're never flagged even if they haven't signed in yet.
      pending: !!p.invited_at && !p.signed_in_at,
      stats: statsByUser.get(p.id) ?? EMPTY_STATS,
    }))
    .sort(compareByRole);

  return (
    <div className="space-y-6">
      <MembersView members={members} />
    </div>
  );
}
