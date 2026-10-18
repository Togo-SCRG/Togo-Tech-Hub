import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_SELECT,
  MAX_DOCUMENT_BYTES,
  MIGRATION_044_MISSING,
  ensureProjectSettingsRow,
  isMissingTable,
  toProjectDocument,
} from "@/lib/projectDocs";

/**
 * Records a document the browser has just uploaded to Storage.
 *
 * The file itself never passes through here: the browser uploads it straight
 * to the bucket as the signed-in user (the bucket's policies apply exactly as
 * they did to server-side PRD uploads), because a serverless host caps request
 * bodies at a few MB and documents routinely exceed that. This route only adds
 * the row that makes the file part of the project — and the row's insert policy
 * (migration 044) is what decides whether this person may add documents here.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const project = typeof body.project === "string" ? body.project : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const path = typeof body.path === "string" ? body.path : "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : null;
  const contentType = typeof body.contentType === "string" && body.contentType ? body.contentType : null;

  if (!project || !name || !path) {
    return NextResponse.json({ error: "project, name and path are required." }, { status: 400 });
  }
  // The file must sit in this project's own folder: otherwise someone allowed
  // to edit one project could attach a file that belongs to another.
  if (!path.startsWith(`${project}/`) || path.includes("..")) {
    return NextResponse.json({ error: "That file isn't in this project's folder." }, { status: 400 });
  }
  if (size !== null && size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Each document must be 20 MB or smaller." }, { status: 400 });
  }

  // Signing a URL doubles as an existence check, so a row can't point at a
  // file that was never uploaded.
  const { error: missingFile } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60);
  if (missingFile) {
    return NextResponse.json({ error: "The uploaded file couldn't be found. Please try again." }, { status: 400 });
  }

  await ensureProjectSettingsRow(supabase, project);

  const { data, error } = await supabase
    .from("project_documents")
    .insert({
      project,
      name,
      storage_path: path,
      size_bytes: size,
      content_type: contentType,
      uploaded_by: user.id,
    })
    .select(DOCUMENT_SELECT)
    .single();

  if (error) {
    // Don't leave an orphaned file behind a row that was refused.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (isMissingTable(error, "project_documents")) {
      return NextResponse.json({ error: MIGRATION_044_MISSING }, { status: 400 });
    }
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to add documents to this project." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ document: toProjectDocument(data) });
}
