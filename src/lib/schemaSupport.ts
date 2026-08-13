import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a migration has actually been run yet.
 *
 * Migrations here are applied by hand in the Supabase SQL Editor, so there is
 * always a window where deployed code is ahead of the database. Code that simply
 * assumes a new column exists doesn't degrade in that window — it throws, and
 * because these columns live on shared tables it takes unrelated features down
 * with it. Selecting `side_note` in the project-settings endpoint broke the
 * weekly hour cap, the timeline and the overview, none of which had anything to
 * do with side notes.
 *
 * So: ask once, cheaply, and adapt.
 */

/**
 * A `true` is cached forever — a column can't un-exist.
 *
 * A `false` is cached for a short while rather than not at all. Re-probing on
 * every request meant an extra Supabase round trip per page for every
 * outstanding migration, and because the result is needed before the page's main
 * queries can be built, those round trips were serialised in front of everything
 * else — several hundred milliseconds of dead time on every navigation. A minute
 * of staleness is a fair trade: run the migration and the app picks it up on its
 * own shortly after, still with no redeploy.
 */
const RETRY_AFTER_MS = 60_000;

const confirmed = new Set<string>();
const missingUntil = new Map<string, number>();

async function columnExists(
  supabase: SupabaseClient,
  table: string,
  column: string
): Promise<boolean> {
  const key = `${table}.${column}`;
  if (confirmed.has(key)) return true;

  const retryAt = missingUntil.get(key);
  if (retryAt !== undefined && Date.now() < retryAt) return false;

  const { error } = await supabase.from(table).select(column).limit(1);
  if (error) {
    missingUntil.set(key, Date.now() + RETRY_AFTER_MS);
    return false;
  }

  missingUntil.delete(key);
  confirmed.add(key);
  return true;
}

/**
 * Has migration 040 run? Decides whether project/task can be told apart at all.
 *
 * When false, every row is project work — which is exactly what it was before
 * 040 — so callers should skip the filter rather than apply it and error.
 */
export function hasWorkType(supabase: SupabaseClient): Promise<boolean> {
  return columnExists(supabase, "daily_updates", "work_type");
}

/** Has migration 039 run? Decides whether project side notes can be read or written. */
export function hasSideNote(supabase: SupabaseClient): Promise<boolean> {
  return columnExists(supabase, "project_settings", "side_note");
}

/**
 * Has migration 041 run? Decides whether a task can exist before work is logged
 * against it. Without it, tasks are still readable — they're just whatever names
 * appear on task-typed rows.
 */
export function hasTasksTable(supabase: SupabaseClient): Promise<boolean> {
  return columnExists(supabase, "tasks", "name");
}

/**
 * Applies `work_type = 'project'` only when the column is there.
 *
 * `q` is a PostgREST query builder mid-chain; typing it precisely would mean
 * naming a generic Supabase internal, and every caller passes the same shape.
 */
export function onlyProjectWork<T>(query: T, supported: boolean): T {
  if (!supported) return query;
  return (query as { eq: (col: string, val: string) => T }).eq("work_type", "project");
}
