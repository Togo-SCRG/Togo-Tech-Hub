import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { checkNoteCategory } from "@/lib/noteCategories";
import { MIGRATION_050_MISSING, NOTE_SELECT, NOTE_SELECT_PRE_050, isMissingColumn, toProjectSideNote } from "@/lib/projectDocs";

// Both handlers lean on the table's policies (migration 044) for permission. A
// refused update or delete isn't an error to PostgREST — it simply matches no
// rows — so "nothing changed" is reported as a permission problem.

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "A note can't be empty — delete it instead." }, { status: 400 });
  }
  const checked = checkNoteCategory(body.category, text);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  let { data, error } = await supabase
    .from("project_side_notes")
    .update({ body: text, category: checked.category, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select(NOTE_SELECT)
    .maybeSingle();

  // Before 050 there's no category to save: a side note's text still can be.
  if (error && isMissingColumn(error)) {
    if (checked.category !== "side_note") {
      return NextResponse.json({ error: MIGRATION_050_MISSING }, { status: 400 });
    }
    ({ data, error } = await supabase
      .from("project_side_notes")
      .update({ body: text, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .select(NOTE_SELECT_PRE_050)
      .maybeSingle());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "You don't have permission to edit this note." }, { status: 403 });
  }

  return NextResponse.json({ note: toProjectSideNote(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error, count } = await supabase
    .from("project_side_notes")
    .delete({ count: "exact" })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You don't have permission to delete this note." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
