import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { MAX_DOCUMENT_BYTES } from "@/lib/projectDocs";
import { MIGRATION_049_MISSING, RESOURCE_FILES_BUCKET, isResourcesMissing } from "@/lib/resources";

/**
 * Records a file the browser has just uploaded to the resource-files bucket —
 * the same two-step shape as project and proposal documents (the bytes go
 * straight to Storage; this adds the row). Anyone on the team may (049).
 */
export async function POST(req: NextRequest) {
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
  if (!path.startsWith("library/") || path.includes("..")) {
    return NextResponse.json({ error: "That file isn't in the library's folder." }, { status: 400 });
  }
  if (size !== null && size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Each file must be 20 MB or smaller." }, { status: 400 });
  }

  // Signing a URL doubles as an existence check.
  const bucket = supabase.storage.from(RESOURCE_FILES_BUCKET);
  const { error: missingFile } = await bucket.createSignedUrl(path, 60);
  if (missingFile) {
    return NextResponse.json({ error: "The uploaded file couldn't be found. Please try again." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("resource_files")
    .insert({ name, storage_path: path, size_bytes: size, content_type: contentType, uploaded_by: user.id })
    .select("id, name, size_bytes, content_type, created_at, profiles(name)")
    .single();

  if (error) {
    await bucket.remove([path]);
    if (isResourcesMissing(error)) return NextResponse.json({ error: MIGRATION_049_MISSING }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to add files to the library." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  const uploader = data.profiles as unknown as { name?: string } | null;
  return NextResponse.json({
    document: {
      id: data.id,
      name: data.name,
      size: data.size_bytes ?? null,
      contentType: data.content_type ?? null,
      uploadedAt: data.created_at,
      uploadedBy: uploader?.name ?? null,
    },
  });
}
