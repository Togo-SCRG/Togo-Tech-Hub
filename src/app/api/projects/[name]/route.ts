import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { capabilitiesFor } from "@/lib/permissions";
import { DOCUMENTS_BUCKET } from "@/lib/projectDocs";
import type { AccessLevel } from "@/types";

// Projects aren't a real table (just a free-text field shared across
// daily_updates / time_entries / member_projects), so "deleting a project"
// means purging every row across those tables — plus its project_settings
// row (weekly cap) — that matches this name. RLS already lets admins
// delete any row in each of those tables, so the normal session client
// (not the service-role client) is enough here.
export async function DELETE(_req: NextRequest, { params }: { params: { name: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();
  const caps = await capabilitiesFor(supabase, callerProfile?.access_level as AccessLevel, user.id);
  if (!caps.includes("project.delete")) {
    return NextResponse.json({ error: "You don't have permission to delete a project." }, { status: 403 });
  }

  const projectName = decodeURIComponent(params.name);

  // The project's files, read before the settings row goes: deleting that row
  // cascades to project_documents (migration 044), and with it the record of
  // where the files are. Missing table (pre-044) or column just means no paths.
  const [{ data: documents }, { data: settings }] = await Promise.all([
    supabase.from("project_documents").select("storage_path").eq("project", projectName),
    supabase.from("project_settings").select("*").eq("project", projectName).maybeSingle(),
  ]);
  const filePaths = [
    ...(documents || []).map((d) => d.storage_path as string),
    ...(settings?.prd_file_path ? [settings.prd_file_path as string] : []),
  ];

  const [updatesResult, timeEntriesResult, memberProjectsResult] = await Promise.all([
    supabase.from("daily_updates").delete().eq("project", projectName),
    supabase.from("time_entries").delete().eq("project", projectName),
    supabase.from("member_projects").delete().eq("project", projectName),
  ]);
  await supabase.from("project_settings").delete().eq("project", projectName);
  // Not fatal if this table doesn't exist yet (migration 038), so it's kept out
  // of the checked results below.
  await supabase.from("project_blockers").delete().eq("project", projectName);

  const failed = [updatesResult, timeEntriesResult, memberProjectsResult].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 400 });
  }

  // Best effort: the project is gone either way, and a file the bucket's
  // policies won't let this person remove is clutter, not a failure.
  if (filePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([...new Set(filePaths)]);
    if (storageError) console.error(`[projects] couldn't remove files for ${projectName}: ${storageError.message}`);
  }

  return NextResponse.json({ ok: true });
}
