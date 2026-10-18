import type { SupabaseClient } from "@supabase/supabase-js";
import { isRealBlocker } from "@/lib/blockers";

/**
 * A blocker as the UI deals with it, from either of the two places one can live.
 *
 * `source` is what the edit and resolve buttons route on: a "project" blocker is
 * a row in project_blockers, an "update" blocker is the `blockers` text on a
 * daily_updates row. They look identical on screen and behave the same, but they
 * are not the same record, so they can't share an endpoint.
 */
export type BlockerSource = "project" | "update";

export interface ProjectBlockerRow {
  id: string;
  project: string;
  userName: string;
  avatarUrl: string | null;
  blockers: string;
  date: string;
  /** Full timestamp, where there is one — for ordering by recency. */
  createdAt?: string;
  source: BlockerSource;
}

/**
 * Outstanding standalone blockers, optionally for one project.
 *
 * Returns [] rather than throwing when the table isn't there. Migrations in this
 * project are applied by hand, so between deploying this code and running 038
 * every page that reads blockers would otherwise 500 — and a project page that
 * won't load is a far worse failure than a blocker card reading zero.
 */
export async function fetchProjectBlockers(
  supabase: SupabaseClient,
  project?: string
): Promise<ProjectBlockerRow[]> {
  let query = supabase
    .from("project_blockers")
    .select("id, project, blocker, created_at, profiles(name, avatar_url)")
    .is("resolved_at", null)
    .order("created_at", { ascending: false });

  if (project) query = query.eq("project", project);

  const { data, error } = await query;

  if (error) {
    const missingTable =
      error.code === "42P01" || error.code === "PGRST205" || /project_blockers/i.test(error.message);
    if (!missingTable) {
      console.error(`[project-blockers] query failed: ${error.code} ${error.message}`);
    }
    return [];
  }

  return (data || [])
    .map((row) => {
      const author = row.profiles as unknown as { name?: string; avatar_url?: string | null } | null;
      return {
        id: row.id as string,
        project: row.project as string,
        userName: author?.name || "Someone",
        avatarUrl: author?.avatar_url ?? null,
        blockers: (row.blocker as string) ?? "",
        // Date-only, to match the `date` column daily-update blockers carry —
        // the two are rendered by the same component.
        date: (row.created_at as string).slice(0, 10),
        createdAt: row.created_at as string,
        source: "project" as const,
      };
    })
    // Placeholders like "N/A" or "None" aren't real blockers. Same guard every
    // other read path applies to the daily_updates column.
    .filter((b) => isRealBlocker(b.blockers));
}
