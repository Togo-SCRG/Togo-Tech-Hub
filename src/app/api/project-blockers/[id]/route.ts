import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

/** Reword a blocker. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const blocker = typeof body.blocker === "string" ? body.blocker.trim() : "";
  if (!blocker) {
    return NextResponse.json({ error: "Blocker text is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("project_blockers")
    .update({ blocker })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to edit this blocker." : error.message },
      { status: denied ? 403 : 400 }
    );
  }
  // No row came back and no error: RLS filtered it out, or it's already gone.
  if (!data) {
    return NextResponse.json({ error: "That blocker no longer exists." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, blocker });
}

/**
 * Resolve it. Soft, unlike the daily_updates path that blanks the text — the row
 * stays so a project keeps its record of what held it up, and every read filters
 * on `resolved_at is null`.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("project_blockers")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", params.id)
    .is("resolved_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to resolve this blocker." : error.message },
      { status: denied ? 403 : 400 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "That blocker is already resolved." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
