import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

const LIMIT = 50;

const SELECT =
  // The actor join needs the FK named explicitly: there are two foreign keys to
  // profiles (user_id and actor_id) and PostgREST can't guess which.
  "id, type, project, role, read_at, archived_at, created_at, actor:profiles!notifications_actor_id_fkey(name, avatar_url)";

/**
 * The signed-in user's notifications.
 *
 * `?filter=all` (default) and `unread` cover the inbox and exclude archived
 * rows; `archived` returns only those. RLS scopes every case to the caller.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = new URL(req.url).searchParams.get("filter") ?? "all";

  let query = supabase
    .from("notifications")
    .select(SELECT)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (filter === "archived") {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
    if (filter === "unread") query = query.is("read_at", null);
  }

  const { data, error } = await query;

  if (error) {
    // An empty list keeps the nav working, but staying quiet about *why* would
    // hide a broken query behind a bell that never shows anything. A missing
    // table or column just means the migrations haven't been run.
    const notMigrated =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      error.code === "PGRST204" ||
      error.code === "42703" ||
      /notifications|archived_at/i.test(error.message);
    if (!notMigrated) {
      console.error(`[notifications] query failed: ${error.code} ${error.message}`);
    }
    return NextResponse.json({ notifications: [], unreadCount: 0, archivedCount: 0 });
  }

  const notifications = (data || []).map((n) => {
    const actor = n.actor as unknown as { name?: string; avatar_url?: string | null } | null;
    return {
      id: n.id as string,
      type: n.type as string,
      project: n.project as string,
      role: (n.role as string | null) ?? null,
      readAt: (n.read_at as string | null) ?? null,
      archivedAt: (n.archived_at as string | null) ?? null,
      createdAt: n.created_at as string,
      actorName: actor?.name ?? null,
      actorAvatarUrl: actor?.avatar_url ?? null,
    };
  });

  // Counted independently of the current filter, so the tab labels and the nav
  // badge stay correct while you're looking at, say, the Archived tab.
  //
  // unread drives the Unread tab; unseen drives the red badge. They're separate
  // so opening the bell can silence the badge without marking anything read
  // (migration 021).
  const [{ count: unreadCount }, { count: archivedCount }, unseen] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .is("archived_at", null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("archived_at", "is", null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("seen_at", null)
      .is("archived_at", null),
  ]);

  return NextResponse.json({
    notifications,
    unreadCount: unreadCount ?? 0,
    archivedCount: archivedCount ?? 0,
    // Before migration 021 the seen_at query errors and its count is null, so
    // the badge falls back to the unread count — the old behaviour — rather
    // than silently reading zero and never appearing.
    unseenCount: unseen.error ? unreadCount ?? 0 : unseen.count ?? 0,
  });
}

/** Marks every unread, non-archived notification of the caller as read. */
export async function PATCH() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  // seen_at too: having read something necessarily means having seen it. Without
  // this the badge would clear optimistically and then reappear on the next
  // fetch, because the unseen count would still include these rows.
  let { error } = await supabase
    .from("notifications")
    .update({ read_at: now, seen_at: now })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("archived_at", null);

  // seen_at arrives with migration 021; fall back to read_at alone without it.
  if (error?.code === "PGRST204" || error?.code === "42703" || /seen_at/.test(error?.message || "")) {
    ({ error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null)
      .is("archived_at", null));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
