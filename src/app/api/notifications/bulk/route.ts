import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// The list this acts on is capped at 50 server-side, so this is a sanity bound
// on the payload rather than a limit anyone can reach through the UI.
const MAX_IDS = 200;

/**
 * The same actions as /api/notifications/[id], applied to a set of rows.
 *
 * Deliberately not role-gated: a notification belongs to exactly one person,
 * and the RLS policies from migration 019 scope every statement here to the
 * caller's own rows. `.eq("user_id", user.id)` is belt-and-braces on top of
 * that — an id belonging to someone else simply doesn't match, so a forged
 * list can't touch another person's inbox.
 */
function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = Array.from(
    new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  return ids.length > 0 ? ids.slice(0, MAX_IDS) : null;
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { read, archived } = body as { read?: boolean; archived?: boolean };
  const ids = parseIds(body.ids);
  if (!ids) {
    return NextResponse.json({ error: "Select at least one notification." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {};
  if (read !== undefined) data.read_at = read ? now : null;
  if (archived !== undefined) {
    data.archived_at = archived ? now : null;
    // Archiving is a form of dismissal, so it implies read — otherwise a row
    // could sit archived and still be counted as unread. Same rule as the
    // single-row route.
    if (archived) data.read_at = now;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Acting on a notification means you've seen it. Marking rows back to *unread*
  // deliberately leaves seen_at alone: you've still seen them, you just want
  // them flagged for later.
  const withSeen = data.read_at || data.archived_at ? { ...data, seen_at: now } : data;

  let { data: updated, error } = await supabase
    .from("notifications")
    .update(withSeen)
    .in("id", ids)
    .eq("user_id", user.id)
    .select("id");

  // seen_at arrives with migration 021; retry without it on an older database.
  if (error?.code === "PGRST204" || error?.code === "42703" || /seen_at/.test(error?.message || "")) {
    ({ data: updated, error } = await supabase
      .from("notifications")
      .update(data)
      .in("id", ids)
      .eq("user_id", user.id)
      .select("id"));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updated: updated?.length ?? 0 });
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ids = parseIds(body.ids);
  if (!ids) {
    return NextResponse.json({ error: "Select at least one notification." }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("notifications")
    .delete({ count: "exact" })
    .in("id", ids)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
