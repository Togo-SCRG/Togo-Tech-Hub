import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications";
import { isTimelineOverdue, parseTimelineDate } from "@/lib/timeline";

/**
 * Raises a "project is overdue" notification for every project whose timeline
 * has passed while it's still unfinished.
 *
 * Run on demand — called when someone opens the projects list — because there's
 * no scheduler in this app. That means the notice appears the first time anyone
 * uses the app after the deadline passes, not at midnight on the dot. The
 * dedupe key is what makes that safe: without it the same notice would be
 * raised on every page load by every viewer.
 *
 * The key includes the timeline it went overdue against, so extending a
 * deadline and then missing the new one raises a fresh notice.
 */
export async function POST() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: settings, error } = await supabase
    .from("project_settings")
    .select("project, timeline, status")
    .not("timeline", "is", null)
    .neq("timeline", "");

  if (error) {
    // Timeline column missing means migration 026 hasn't run — nothing to do.
    return NextResponse.json({ checked: 0, overdue: 0 });
  }

  const overdue = (settings || []).filter((s) =>
    isTimelineOverdue(s.timeline as string, s.status as string)
  );

  if (overdue.length === 0) {
    return NextResponse.json({ checked: settings?.length ?? 0, overdue: 0 });
  }

  const { data: everyone } = await supabase.from("profiles").select("id");
  const recipients = (everyone || []).map((p) => p.id as string);

  // Service role: these rows have no actor, and the notifications insert policy
  // requires actor_id = auth.uid(). Writing them as the triggering user would
  // also exclude that person from their own notification.
  const admin = createAdminClient();

  await Promise.all(
    overdue.map((s) => {
      const due = parseTimelineDate(s.timeline as string);
      const key = `overdue:${s.project}:${due ? due.toISOString().slice(0, 10) : s.timeline}`;
      return notify(admin, {
        userIds: recipients,
        actorId: null,
        type: "project_overdue",
        project: s.project as string,
        dedupeKey: key,
      });
    })
  );

  return NextResponse.json({ checked: settings?.length ?? 0, overdue: overdue.length });
}
