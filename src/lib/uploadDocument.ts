import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET, MAX_DOCUMENT_BYTES, documentStoragePath } from "@/lib/projectDocs";
import { PROPOSAL_FILES_BUCKET, proposalStoragePath } from "@/lib/proposals";
import { RESOURCE_FILES_BUCKET, libraryStoragePath } from "@/lib/resources";
import type { DocumentItem } from "@/types";

/**
 * Uploads one file as a document, from the browser.
 *
 * Two steps: the file goes straight to Storage as the signed-in user, then an
 * API route records it against its owner (a project or a proposal). Going
 * direct is what lets documents be larger than a serverless request body
 * allows; the API step is where the owner-level permission is checked.
 *
 * Throws with a message naming the file, ready to show as-is.
 */
async function uploadDocument({
  bucket,
  path,
  file,
  recordUrl,
  recordBody = {},
}: {
  bucket: string;
  path: string;
  file: File;
  recordUrl: string;
  recordBody?: Record<string, unknown>;
}): Promise<DocumentItem> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`“${file.name}” is over 20 MB.`);
  }

  const storage = createClient().storage.from(bucket);
  const { error: uploadError } = await storage.upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadError) {
    throw new Error(`“${file.name}” couldn't be uploaded: ${uploadError.message}`);
  }

  const res = await fetch(recordUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...recordBody, name: file.name, path, size: file.size, contentType: file.type || null }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The route removes the file when it refuses the record, but a request
    // turned away before reaching it — a "View as" preview, which blocks every
    // write at the middleware — never gets that far. Removing it here as well
    // covers both; a second remove of a missing file is harmless.
    await storage.remove([path]).catch(() => {});
    throw new Error(data.error || `“${file.name}” couldn't be added.`);
  }
  return data.document as DocumentItem;
}

export function uploadProjectDocument(project: string, file: File): Promise<DocumentItem> {
  return uploadDocument({
    bucket: DOCUMENTS_BUCKET,
    path: documentStoragePath(project, file.name),
    file,
    recordUrl: "/api/project-documents",
    recordBody: { project },
  });
}

/** A file for the Resources library — the team's own, not a project's or a proposal's. */
export function uploadLibraryFile(file: File): Promise<DocumentItem> {
  return uploadDocument({
    bucket: RESOURCE_FILES_BUCKET,
    path: libraryStoragePath(file.name),
    file,
    recordUrl: "/api/resource-files",
  });
}

export function uploadProposalDocument(proposalId: string, file: File): Promise<DocumentItem> {
  return uploadDocument({
    bucket: PROPOSAL_FILES_BUCKET,
    path: proposalStoragePath(proposalId, file.name),
    file,
    recordUrl: `/api/proposals/${proposalId}/documents`,
  });
}
