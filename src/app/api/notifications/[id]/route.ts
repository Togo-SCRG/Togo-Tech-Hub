import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

/**
 * Per-notification actions: mark read/unread, archive/unarchive.
 *
 * Both fields accept a boolean so each action can be undone — the RLS policies
 * from migration 019 restrict every row touched to the caller's own, so there's
 * no ownership check to repeat here.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { read, archived } = body as { read?: boolean; archived?: boolean };

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {};
  if (read !== undefined) data.read_at = read ? now : null;
  if (archived !== undefined) {
    data.archived_at = archived ? now : null;
    // Archiving is a form of dismissal, so it implies read — otherwise a row
    // could sit archived and still be counted as unread.
    if (archived) data.read_at = now;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Acting on a notification means you've seen it, so keep seen_at in step and
  // stop the badge counting a row you've just dealt with. Marking something
  // back to *unread* deliberately leaves seen_at alone: you've still seen it,
  // you just want it flagged for later.
  const withSeen = data.read_at || data.archived_at ? { ...data, seen_at: now } : data;

  let { data: updated, error } = await supabase
    .from("notifications")
    .update(withSeen)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, read_at, archived_at")
    .maybeSingle();

  // seen_at arrives with migration 021; retry without it on an older database.
  if (error?.code === "PGRST204" || error?.code === "42703" || /seen_at/.test(error?.message || "")) {
    ({ data: updated, error } = await supabase
      .from("notifications")
      .update(data)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id, read_at, archived_at")
      .maybeSingle());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({
    notification: {
      id: updated.id,
      readAt: updated.read_at,
      archivedAt: updated.archived_at,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error, count } = await supabase
    .from("notifications")
    .delete({ count: "exact" })
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
