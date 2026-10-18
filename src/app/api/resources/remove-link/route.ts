import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { findLinks } from "@/components/ui/LinkifiedText";
import { isNoteCategory, removeLinkFromText } from "@/lib/noteCategories";

/**
 * Removes a link that Resources gathered from a project or a proposal — by
 * taking it out of the text it was written in, since that text is where the
 * link actually lives:
 *
 *   * from every note of that kind on that project/proposal that contains it;
 *     a note left with nothing else in it is deleted, and a client-portal or
 *     system-link note left with no link becomes a side note, so its words
 *     survive;
 *   * or from the project's overview / the proposal's summary.
 *
 * Every write goes through the same policies as editing the note or overview
 * by hand (044/050 for projects, 045/048 for proposals), so this can't remove
 * anything its caller couldn't have edited themselves.
 *
 * Body: { source: "project" | "proposal", sourceKey, kind, href }.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const source = body.source === "project" || body.source === "proposal" ? body.source : null;
  const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : "";
  const href = typeof body.href === "string" ? body.href : "";
  const kind = body.kind === "overview" || isNoteCategory(body.kind) ? body.kind : null;
  if (!source || !sourceKey || !href || !kind) {
    return NextResponse.json({ error: "source, sourceKey, kind and href are required." }, { status: 400 });
  }

  const denied = () => NextResponse.json({ error: "You don't have permission to change where that link is written." }, { status: 403 });

  // ── The overview or summary ──────────────────────────────────────────────
  if (kind === "overview") {
    const table = source === "project" ? "project_settings" : "proposals";
    const keyColumn = source === "project" ? "project" : "id";
    const textColumn = source === "project" ? "overview" : "summary";
    const { data: row } = await supabase.from(table).select(textColumn).eq(keyColumn, sourceKey).maybeSingle();
    const text = (row as Record<string, string | null> | null)?.[textColumn] ?? "";
    if (!text) return NextResponse.json({ error: "That text no longer exists." }, { status: 404 });

    const next = removeLinkFromText(text, href);
    const { data: updated, error } = await supabase
      .from(table)
      .update({ [textColumn]: next || null })
      .eq(keyColumn, sourceKey)
      .select(keyColumn)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!updated) return denied();
    return NextResponse.json({ ok: true, notesChanged: 0, notesDeleted: 0 });
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  const isProject = source === "project";
  const table = isProject ? "project_side_notes" : "proposal_activity";
  const textColumn = isProject ? "body" : "detail";
  const categoryColumn = isProject ? "category" : "note_category";

  let query = supabase.from(table).select(`id, ${textColumn}, ${categoryColumn}`);
  query = isProject
    ? query.eq("project", sourceKey)
    : query.eq("proposal_id", sourceKey).eq("kind", "note");
  // Side notes from before the categories existed have no value to match on.
  query = kind === "side_note" ? query.or(`${categoryColumn}.eq.side_note,${categoryColumn}.is.null`) : query.eq(categoryColumn, kind);

  const { data: notes, error: readError } = await query;
  if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });

  let changed = 0;
  let deleted = 0;
  for (const note of (notes || []) as unknown as Record<string, string | null>[]) {
    const text = note[textColumn] ?? "";
    const next = removeLinkFromText(text, href);
    if (next === text.trim()) continue; // the link isn't in this one

    if (!next) {
      const { count, error } = await supabase.from(table).delete({ count: "exact" }).eq("id", note.id as string);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!count) return denied();
      deleted++;
      continue;
    }

    // A portal/system note must contain a link; with its last one gone it's a
    // side note now, which keeps the words without breaking that rule.
    const stillLinked = findLinks(next).length > 0;
    const patch: Record<string, unknown> = { [textColumn]: next };
    if (kind !== "side_note" && !stillLinked) patch[categoryColumn] = "side_note";
    if (isProject) patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase.from(table).update(patch).eq("id", note.id as string).select("id").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!updated) return denied();
    changed++;
  }

  return NextResponse.json({ ok: true, notesChanged: changed, notesDeleted: deleted });
}
