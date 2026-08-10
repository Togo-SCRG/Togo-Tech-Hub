import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasTasksTable } from "@/lib/schemaSupport";

/**
 * Edit a task's description.
 *
 * Upserts rather than updates: a task that only exists because work was logged
 * against the name has no `tasks` row yet, and describing it is a reasonable
 * moment to create one.
 */
export async function PATCH(req: NextRequest, { params }: { params: { name: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasTasksTable(supabase))) {
    return NextResponse.json(
      { error: "Tasks aren't set up yet — run migration 041 in Supabase." },
      { status: 400 }
    );
  }

  const name = decodeURIComponent(params.name);
  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";

  const { data, error } = await supabase
    .from("tasks")
    .upsert({ name, description: description || null, created_by: user.id }, { onConflict: "name" })
    .select("name, description")
    .single();

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to edit this task." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ task: { name: data.name, description: data.description } });
}
