import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { checkNoteCategory } from "@/lib/noteCategories";
import {
  MIGRATION_044_MISSING,
  MIGRATION_050_MISSING,
  NOTE_SELECT,
  NOTE_SELECT_PRE_050,
  ensureProjectSettingsRow,
  isMissingColumn,
  isMissingTable,
  toProjectSideNote,
} from "@/lib/projectDocs";

/** Adds a side note. Who may is decided by the table's insert policy (migration 044). */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const project = typeof body.project === "string" ? body.project : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!project) {
    return NextResponse.json({ error: "project is required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "A note can't be empty." }, { status: 400 });
  }
  // A portal or system note is what the Projects list shows as the link, so it
  // has to contain one.
  const checked = checkNoteCategory(body.category, text);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  await ensureProjectSettingsRow(supabase, project);

  let { data, error } = await supabase
    .from("project_side_notes")
    .insert({ project, body: text, category: checked.category, created_by: user.id })
    .select(NOTE_SELECT)
    .single();

  // Before 050 there's no category column. A plain side note can still be
  // saved the old way; a portal or system note needs the migration.
  if (error && isMissingColumn(error)) {
    if (checked.category !== "side_note") {
      return NextResponse.json({ error: MIGRATION_050_MISSING }, { status: 400 });
    }
    ({ data, error } = await supabase
      .from("project_side_notes")
      .insert({ project, body: text, created_by: user.id })
      .select(NOTE_SELECT_PRE_050)
      .single());
  }

  if (error || !data) {
    if (isMissingTable(error, "project_side_notes")) {
      return NextResponse.json({ error: MIGRATION_044_MISSING }, { status: 400 });
    }
    if (!error) return NextResponse.json({ error: "Couldn't add the note." }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to add notes to this project." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ note: toProjectSideNote(data) });
}
