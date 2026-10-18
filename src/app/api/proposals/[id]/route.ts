import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { PROPOSAL_FILES_BUCKET, PROPOSAL_SELECT, parseProposalFields, toProposal } from "@/lib/proposals";

// Both handlers rely on the proposals policies (migration 045) for permission.
// A refused update or delete isn't an error to PostgREST — it matches no rows —
// so "nothing changed" is reported as not found or not allowed.

/** Edit any of a proposal's fields, status included. Managers only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = parseProposalFields(body, { partial: true });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (Object.keys(parsed.fields).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("proposals")
    .update(parsed.fields)
    .eq("id", params.id)
    .select(PROPOSAL_SELECT)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "That proposal doesn't exist, or you can't edit it." }, { status: 403 });
  }

  return NextResponse.json({ proposal: toProposal(data) });
}

/** Delete a proposal, its history and its files. Managers only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read before the delete: the rows cascade away with the proposal, and with
  // them the record of where its files are.
  const { data: documents } = await supabase
    .from("proposal_documents")
    .select("storage_path")
    .eq("proposal_id", params.id);

  const { error, count } = await supabase.from("proposals").delete({ count: "exact" }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "That proposal doesn't exist, or you can't delete it." }, { status: 403 });
  }

  const paths = (documents || []).map((d) => d.storage_path as string);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(PROPOSAL_FILES_BUCKET).remove(paths);
    if (storageError) console.error(`[proposals] couldn't remove files for ${params.id}: ${storageError.message}`);
  }

  return NextResponse.json({ ok: true });
}
