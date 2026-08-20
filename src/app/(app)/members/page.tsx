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

/** What the roster shows per person. */
export interface MemberStats {
  total: number;
  completed: number;
  projects: string[];
}

const EMPTY_STATS: MemberStats = { total: 0, completed: 0, projects: [] };

/**
 * How much work each person has logged.
 *
 * Counts only — the project list comes from `fetchMemberProjects` below. The
 * view (migration 042) returns one row per member; until it has been run by
 * hand in the SQL Editor this falls back to reading the rows and counting them
 * here, so the page keeps working while deployed code is ahead of the database.
 * The fallback is the slow path on purpose, and stops being used once 042 lands.
 */
async function fetchUpdateCounts(
  supabase: SupabaseClient
): Promise<Map<string, { total: number; completed: number }>> {
  const byUser = new Map<string, { total: number; completed: number }>();

  const { data: rollup, error } = await supabase
    .from("member_update_stats")
    .select("user_id, update_count, completed_count");

  if (!error) {
    for (const row of rollup || []) {
      byUser.set(row.user_id, {
        total: row.update_count ?? 0,
        completed: row.completed_count ?? 0,
      });
    }
    return byUser;
  }

  const { data: updates } = await supabase.from("daily_updates").select("user_id, status");
  for (const u of updates || []) {
    const entry = byUser.get(u.user_id) || { total: 0, completed: 0 };
    entry.total += 1;
    if (u.status === "Completed") entry.completed += 1;
    byUser.set(u.user_id, entry);
  }
  return byUser;
}

/**
 * Which projects each person is on.
 *
 * Read from member_projects — the same table the profile page's Projects tab
 * shows, so the roster's count can't disagree with the profile's. That table is
 * maintained for you: logging project work adds a row if one is missing, and
 * task-typed work deliberately doesn't (see lib/memberProjects.ts), so tasks
 * can't appear here at all.
 *
 * This replaced a distinct over every row of daily_updates, which counted the
 * tasks *and* any project someone had logged against without being on it.
 */
async function fetchMemberProjects(supabase: SupabaseClient): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();

  const { data } = await supabase
    .from("member_projects")
    .select("user_id, project")
    .order("created_at", { ascending: true });

  for (const row of data || []) {
    const list = byUser.get(row.user_id) || [];
    // One row per person per project is the norm, but nothing in the schema
    // enforces it, so don't let a duplicate inflate the count.
    if (row.project && !list.includes(row.project)) list.push(row.project);
    byUser.set(row.user_id, list);
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

  // All three concurrently: none of them depends on another's result. These
  // used to be sequential awaits, so the page waited out every round trip end
  // to end before it could render anything.
  const [profiles, countsByUser, projectsByUser] = await Promise.all([
    fetchProfiles(supabase),
    fetchUpdateCounts(supabase),
    fetchMemberProjects(supabase),
  ]);

  const members = profiles
    .map((p) => ({
      ...p,
      // Invited but never signed in. Seeded accounts have no invited_at, so
      // they're never flagged even if they haven't signed in yet.
      pending: !!p.invited_at && !p.signed_in_at,
      stats: {
        ...(countsByUser.get(p.id) ?? { total: 0, completed: 0 }),
        projects: projectsByUser.get(p.id) ?? EMPTY_STATS.projects,
      },
    }))
    .sort(compareByRole);

  return (
    <div className="space-y-6">
      <MembersView members={members} />
    </div>
  );
}
