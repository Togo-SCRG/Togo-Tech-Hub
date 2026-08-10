import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normaliseWorkType } from "@/lib/workType";
import { hasWorkType } from "@/lib/schemaSupport";

function toCamel(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    user: row.profiles
      ? { id: row.profiles.id, name: row.profiles.name, avatarUrl: row.profiles.avatar_url, role: row.profiles.role }
      : undefined,
    project: row.project,
    workType: normaliseWorkType(row.work_type),
    phase: row.phase,
    date: row.date,
    durationMinutes: row.duration_minutes,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { project, phase, date, durationMinutes, note, workType } = body;

  const data: Record<string, unknown> = {};
  if (project !== undefined) data.project = project;
  // Editable, so an entry logged against the wrong kind can be corrected without
  // deleting and re-adding it. Skipped before migration 040, where there's only
  // one kind for it to be.
  if (workType !== undefined && (await hasWorkType(supabase))) {
    data.work_type = normaliseWorkType(workType);
  }
  if (phase !== undefined) data.phase = phase;
  if (date !== undefined) data.date = date;
  if (durationMinutes !== undefined) data.duration_minutes = durationMinutes;
  if (note !== undefined) data.note = note;

  const { data: updated, error } = await supabase
    .from("time_entries")
    .update(data)
    .eq("id", params.id)
    .select("*, profiles(id, name, avatar_url, role)")
    .single();

  if (error) {
    return NextResponse.json({ error: "You can only edit your own time entries." }, { status: 403 });
  }

  return NextResponse.json({ entry: toCamel(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error, count } = await supabase.from("time_entries").delete({ count: "exact" }).eq("id", params.id);

  if (error || !count) {
    return NextResponse.json({ error: "You can only delete your own time entries." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
