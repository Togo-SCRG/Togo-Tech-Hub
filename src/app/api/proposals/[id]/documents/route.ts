import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { MAX_DOCUMENT_BYTES } from "@/lib/projectDocs";
import {
  MIGRATION_045_MISSING,
  PROPOSAL_DOCUMENT_SELECT,
  PROPOSAL_FILES_BUCKET,
  isProposalsMissing,
  toProposalDocument,
} from "@/lib/proposals";

/**
 * Records a file the browser has just uploaded to the proposal-files bucket.
 * The same two-step shape as project documents (see /api/project-documents):
 * the bytes go straight to Storage, this adds the row, and the row's insert
 * policy (migration 045) decides whether this person may.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const path = typeof body.path === "string" ? body.path : "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : null;
  const contentType = typeof body.contentType === "string" && body.contentType ? body.contentType : null;

  if (!name || !path) {
    return NextResponse.json({ error: "name and path are required." }, { status: 400 });
  }
  // The file must be in this proposal's folder, so a manager can't attach
  // another proposal's file to this one.
  if (!path.startsWith(`${params.id}/`) || path.includes("..")) {
    return NextResponse.json({ error: "That file isn't in this proposal's folder." }, { status: 400 });
  }
  if (size !== null && size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Each document must be 20 MB or smaller." }, { status: 400 });
  }

  // Signing a URL doubles as an existence check.
  const bucket = supabase.storage.from(PROPOSAL_FILES_BUCKET);
  const { error: missingFile } = await bucket.createSignedUrl(path, 60);
  if (missingFile) {
    return NextResponse.json({ error: "The uploaded file couldn't be found. Please try again." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("proposal_documents")
    .insert({
      proposal_id: params.id,
      name,
      storage_path: path,
      size_bytes: size,
      content_type: contentType,
      uploaded_by: user.id,
    })
    .select(PROPOSAL_DOCUMENT_SELECT)
    .single();

  if (error) {
    await bucket.remove([path]);
    if (isProposalsMissing(error)) return NextResponse.json({ error: MIGRATION_045_MISSING }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to add documents to proposals." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ document: toProposalDocument(data) });
}
