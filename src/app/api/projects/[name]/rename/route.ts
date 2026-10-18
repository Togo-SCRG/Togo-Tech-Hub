import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// Renaming a project rewrites its name across five tables, so the work happens
// in one database function (migration 037) rather than five calls from here —
// a partial rename would split one project into two. This route is just the
// door: authenticate, hand off, translate the failure into a status code.
//
// Authorisation lives in rename_project() itself, which is where it has to be:
// the function is security definer, so a check here would be advisory only.
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const newName = typeof body.newName === "string" ? body.newName.trim() : "";
  if (!newName) {
    return NextResponse.json({ error: "A project needs a name." }, { status: 400 });
  }

  const oldName = decodeURIComponent(params.name);

  const { data, error } = await supabase.rpc("rename_project", {
    old_name: oldName,
    new_name: newName,
  });

  if (error) {
    // The function raises with a deliberate errcode per failure so the message
    // it wrote can be shown as-is: 42501 denied, 23505 name taken, 22023 the
    // value itself is no good.
    const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
    return NextResponse.json(
      { error: error.message || "Couldn't rename the project." },
      { status }
    );
  }

  return NextResponse.json({ ok: true, project: data as string });
}
