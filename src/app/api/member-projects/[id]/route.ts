import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { notify } from "@/lib/notifications";

function toCamel(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    project: row.project,
    status: row.status,
    role: row.role,
    partnerIds: row.partner_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { project, status, role, partnerIds } = body;

  const data: Record<string, unknown> = {};
  if (project !== undefined) data.project = project;
  if (status !== undefined) data.status = status;
  if (role !== undefined) data.role = role;
  if (partnerIds !== undefined) data.partner_ids = partnerIds;

  const { data: updated, error } = await supabase
    .from("member_projects")
    .update(data)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "You can only edit your own project entries." }, { status: 403 });
  }

  return NextResponse.json({ project: toCamel(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read the row before deleting it — afterwards there's nothing left to say
  // who was on which project.
  const { data: existing } = await supabase
    .from("member_projects")
    .select("user_id, project")
    .eq("id", params.id)
    .maybeSingle();

  const { error, count } = await supabase.from("member_projects").delete({ count: "exact" }).eq("id", params.id);

  if (error || !count) {
    return NextResponse.json({ error: "You can only delete your own project entries." }, { status: 403 });
  }

  if (existing) {
    await notify(supabase, {
      userIds: [existing.user_id as string],
      actorId: user.id,
      type: "project_removed",
      project: existing.project as string,
    });
  }

  return NextResponse.json({ ok: true });
}
