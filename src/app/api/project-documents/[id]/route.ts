import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { DOCUMENTS_BUCKET } from "@/lib/projectDocs";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * A short-lived link to the file. Signed on request rather than when the page
 * renders, so a page left open all afternoon never hands out an expired link.
 *
 * `?download=1` redirects straight to a link that saves the file under its
 * original name — so the Download button can be a plain link. Without it, the
 * link comes back as JSON for the preview, which needs the URL itself (the
 * Office viewer fetches it, and text files are read and rendered in-page).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select("name, storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const { data: signed, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: doc.name } : undefined);

  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Couldn't open that document." }, { status: 400 });
  }

  if (download) return NextResponse.redirect(signed.signedUrl);
  return NextResponse.json({ url: signed.signedUrl, name: doc.name });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select("storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // The row first: its delete policy is the permission check, and an RLS-refused
  // delete isn't an error — it just removes nothing, hence the count.
  const { error, count } = await supabase
    .from("project_documents")
    .delete({ count: "exact" })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You don't have permission to remove this document." }, { status: 403 });
  }

  const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
  if (storageError) {
    // The document is already gone from the project; a leftover file is
    // invisible clutter, not something to fail the request over.
    console.error(`[project-documents] couldn't remove ${doc.storage_path}: ${storageError.message}`);
  }

  return NextResponse.json({ ok: true });
}
