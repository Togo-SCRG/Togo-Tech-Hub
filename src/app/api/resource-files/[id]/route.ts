import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { RESOURCE_FILES_BUCKET } from "@/lib/resources";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * A short-lived link to a library file — JSON for the preview, or with
 * `?download=1` a redirect that saves it under its original name. The same
 * shape as the project and proposal document routes, so one file list drives
 * all three. Anyone signed in, clients too (051).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: file } = await supabase
    .from("resource_files")
    .select("name, storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const { data: signed, error } = await supabase.storage
    .from(RESOURCE_FILES_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: file.name } : undefined);

  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Couldn't open that file." }, { status: 400 });
  }

  if (download) return NextResponse.redirect(signed.signedUrl);
  return NextResponse.json({ url: signed.signedUrl, name: file.name });
}

/** Remove a library file: anyone signed in, clients too (051). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: file } = await supabase
    .from("resource_files")
    .select("storage_path")
    .eq("id", params.id)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const { error, count } = await supabase.from("resource_files").delete({ count: "exact" }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You don't have permission to remove library files." }, { status: 403 });
  }

  const { error: storageError } = await supabase.storage.from(RESOURCE_FILES_BUCKET).remove([file.storage_path]);
  if (storageError) {
    console.error(`[resource-files] couldn't remove ${file.storage_path}: ${storageError.message}`);
  }

  return NextResponse.json({ ok: true });
}
