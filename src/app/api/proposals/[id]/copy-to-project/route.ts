import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import {
  DOCUMENTS_BUCKET,
  MIGRATION_044_MISSING,
  documentStoragePath,
  ensureProjectSettingsRow,
  isMissingTable,
} from "@/lib/projectDocs";
import { PROPOSAL_FILES_BUCKET } from "@/lib/proposals";

/**
 * Copies a won proposal's documents into the project it became.
 *
 * Copies, not moves: the proposal keeps its own record of what was sent. Each
 * file is duplicated in Storage (proposal-files → project-files, under the
 * project's folder) and recorded in project_documents, all as the signed-in
 * user, so every step is checked by the same policies as doing it by hand —
 * reading the proposal's files (045) and adding the project's (044).
 *
 * Safe to run again: a document the project already has — same name and size —
 * is skipped, so a second run only fills in what's missing.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: proposal } = await supabase.from("proposals").select("project").eq("id", params.id).maybeSingle();
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }
  const project = proposal.project as string | null;
  if (!project) {
    return NextResponse.json({ error: "This proposal isn't linked to a project yet." }, { status: 400 });
  }

  const [{ data: sources }, existingResult] = await Promise.all([
    supabase.from("proposal_documents").select("name, storage_path, size_bytes, content_type").eq("proposal_id", params.id),
    supabase.from("project_documents").select("name, size_bytes").eq("project", project),
  ]);
  if (existingResult.error && isMissingTable(existingResult.error, "project_documents")) {
    return NextResponse.json({ error: MIGRATION_044_MISSING }, { status: 400 });
  }

  const already = new Set((existingResult.data || []).map((d) => `${d.name}|${d.size_bytes ?? ""}`));
  const toCopy = (sources || []).filter((d) => !already.has(`${d.name}|${d.size_bytes ?? ""}`));
  const skipped = (sources || []).length - toCopy.length;

  if (toCopy.length === 0) {
    return NextResponse.json({ copied: 0, skipped, failed: [] });
  }

  await ensureProjectSettingsRow(supabase, project);

  const failed: { name: string; error: string }[] = [];
  let copied = 0;

  // One at a time: a handful of files, and a failure is easier to report
  // against the right one.
  for (const doc of toCopy) {
    const destination = documentStoragePath(project, doc.name as string);

    // A copy inside Storage, without the bytes passing through here. If the
    // storage server won't copy across buckets, fall back to download+upload.
    let { error: copyError } = await supabase.storage
      .from(PROPOSAL_FILES_BUCKET)
      .copy(doc.storage_path as string, destination, { destinationBucket: DOCUMENTS_BUCKET });
    if (copyError) {
      const { data: blob, error: downloadError } = await supabase.storage.from(PROPOSAL_FILES_BUCKET).download(doc.storage_path as string);
      if (downloadError || !blob) {
        failed.push({ name: doc.name as string, error: downloadError?.message || copyError.message });
        continue;
      }
      ({ error: copyError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(destination, blob, {
        contentType: (doc.content_type as string | null) || "application/octet-stream",
      }));
      if (copyError) {
        failed.push({ name: doc.name as string, error: copyError.message });
        continue;
      }
    }

    const { error: insertError } = await supabase.from("project_documents").insert({
      project,
      name: doc.name,
      storage_path: destination,
      size_bytes: doc.size_bytes,
      content_type: doc.content_type,
      uploaded_by: user.id,
    });
    if (insertError) {
      // Don't leave a copy behind that no document points at.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([destination]);
      failed.push({
        name: doc.name as string,
        error: insertError.code === "42501" ? "You don't have permission to add documents to that project." : insertError.message,
      });
      continue;
    }
    copied++;
  }

  return NextResponse.json({ copied, skipped, failed });
}
