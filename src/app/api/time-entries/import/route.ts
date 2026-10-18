import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { ensureMemberProject } from "@/lib/memberProjects";

/** One import is one spreadsheet; this is a sanity bound on the payload. */
const MAX_ROWS = 500;

interface IncomingRow {
  date?: unknown;
  durationMinutes?: unknown;
  phase?: unknown;
  note?: unknown;
}

/**
 * Bulk-create time entries from a spreadsheet.
 *
 * **Super admin only**, and checked here rather than trusted from the client:
 * this writes rows on someone else's behalf in bulk, with dates and durations
 * that never passed through the normal form. Access level is read from the
 * caller's own profile, so a forged request can't claim to be anyone.
 *
 * Deliberately not wired to a capability in the permission matrix — importing is
 * a migration tool, not a role's day-to-day power, and it shouldn't become
 * grantable by ticking a box.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();

  if (profile?.access_level !== "super_admin") {
    return NextResponse.json(
      { error: "Only the super admin can import a time log." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const userId = typeof body.userId === "string" && body.userId ? body.userId : user.id;
  const rows: IncomingRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (!project) {
    return NextResponse.json({ error: "project is required." }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "There are no rows to import." }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That's ${rows.length} rows — ${MAX_ROWS} is the most one import can take.` },
      { status: 400 }
    );
  }

  // Re-validated server-side. The client parsed the spreadsheet and has already
  // filtered it, but nothing stops a request arriving without having done that.
  const prepared: {
    user_id: string;
    project: string;
    phase: string;
    date: string;
    duration_minutes: number;
    note: string;
  }[] = [];

  for (const [index, row] of rows.entries()) {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const minutes = Number(row.durationMinutes);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: `Row ${index + 1} has an invalid date (“${date}”). Expected YYYY-MM-DD.` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return NextResponse.json(
        { error: `Row ${index + 1} has an invalid duration.` },
        { status: 400 }
      );
    }

    prepared.push({
      user_id: userId,
      project,
      phase: typeof row.phase === "string" ? row.phase.trim() : "",
      date,
      duration_minutes: Math.round(minutes),
      note: typeof row.note === "string" ? row.note.trim() : "",
    });
  }

  // One statement: a half-finished import would leave the project's totals wrong
  // with no clear way to tell which rows made it in.
  const { data, error } = await supabase.from("time_entries").insert(prepared).select("id");

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Same as the single-entry route: logging time against a project puts you on it.
  await ensureMemberProject(supabase, userId, project, "In Progress");

  return NextResponse.json({ ok: true, imported: data?.length ?? 0 });
}
