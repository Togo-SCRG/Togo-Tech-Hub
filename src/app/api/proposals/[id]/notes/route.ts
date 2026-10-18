import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { checkNoteCategory } from "@/lib/noteCategories";
import {
  MIGRATION_045_MISSING,
  PROPOSAL_ACTIVITY_SELECT,
  PROPOSAL_ACTIVITY_SELECT_047,
  toProposalActivity,
} from "@/lib/proposals";
import type { NoteCategory } from "@/types";

/**
 * Notes on a proposal's timeline. Everything else on the timeline — status
 * changes, edits, uploads — is written by database triggers (migration 045);
 * a note is the one entry people write themselves, and the only one they can
 * edit (048) or delete. Managers only.
 */

/** A note's text and category, checked the same way for a new note and an edit. */
function parseNote(body: Record<string, unknown>): { text: string; category: NoteCategory } | { error: string } {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { error: "A note can't be empty." };
  if (text.length > 5000) return { error: "Keep notes under 5,000 characters." };

  // A portal or system note is what the Proposals list shows as the link, so
  // one with no link in it would just be a blank space there.
  const checked = checkNoteCategory(body.category, text);
  if ("error" in checked) return checked;
  return { text, category: checked.category };
}

/** PGRST204 / 42703: a column a migration adds isn't there yet. */
const missingColumn = (code?: string) => code === "PGRST204" || code === "42703";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseNote(await req.json().catch(() => ({})));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("proposal_activity")
    .insert({ proposal_id: params.id, kind: "note", note_category: parsed.category, detail: parsed.text, actor_id: user.id })
    // Not the edited_at select: a new note has never been edited, and adding
    // one shouldn't wait on 048 having been run.
    .select(PROPOSAL_ACTIVITY_SELECT_047)
    .single();

  if (error) {
    if (missingColumn(error.code)) return NextResponse.json({ error: MIGRATION_045_MISSING }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to add notes to proposals." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ activity: toProposalActivity(data) });
}

/** Edit a note's text or category (`?noteId=`). Who wrote it and when stay as they were (048's trigger). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = new URL(req.url).searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "noteId is required." }, { status: 400 });
  }

  const parsed = parseNote(await req.json().catch(() => ({})));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("proposal_activity")
    .update({ detail: parsed.text, note_category: parsed.category })
    .eq("id", noteId)
    .eq("proposal_id", params.id)
    .eq("kind", "note")
    .select(PROPOSAL_ACTIVITY_SELECT)
    .maybeSingle();

  if (error) {
    // edited_at missing means 048 hasn't run — and without it there's no
    // update policy either, so editing can't work yet.
    if (missingColumn(error.code)) return NextResponse.json({ error: MIGRATION_045_MISSING }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // A refused update matches no rows rather than erroring.
  if (!data) {
    return NextResponse.json({ error: "You can't edit that note." }, { status: 403 });
  }

  return NextResponse.json({ activity: toProposalActivity(data) });
}

/** Remove a note (`?noteId=`). Only notes — the automatic history can't be deleted. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = new URL(req.url).searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "noteId is required." }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("proposal_activity")
    .delete({ count: "exact" })
    .eq("id", noteId)
    .eq("proposal_id", params.id)
    .eq("kind", "note");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You can't delete that note." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
