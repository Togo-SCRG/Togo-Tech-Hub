import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { PROPOSAL_FILES_BUCKET } from "@/lib/proposals";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * A short-lived link to a proposal's file — JSON for the preview, or with
 * `?download=1` a redirect that saves it under its original name. Same shape
 * as /api/project-documents/[id], so the shared documents panel drives both.
 * Viewers and managers only: the row isn't readable otherwise (migration 045).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doc } = await supabase
    .from("proposal_documents")
    .select("name, storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const { data: signed, error } = await supabase.storage
    .from(PROPOSAL_FILES_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: doc.name } : undefined);

  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Couldn't open that document." }, { status: 400 });
  }

  if (download) return NextResponse.redirect(signed.signedUrl);
  return NextResponse.json({ url: signed.signedUrl, name: doc.name });
}

/** Remove a proposal's file. Managers only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doc } = await supabase
    .from("proposal_documents")
    .select("storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const { error, count } = await supabase
    .from("proposal_documents")
    .delete({ count: "exact" })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You don't have permission to remove this document." }, { status: 403 });
  }

  const { error: storageError } = await supabase.storage.from(PROPOSAL_FILES_BUCKET).remove([doc.storage_path]);
  if (storageError) {
    console.error(`[proposal-documents] couldn't remove ${doc.storage_path}: ${storageError.message}`);
  }

  return NextResponse.json({ ok: true });
}
