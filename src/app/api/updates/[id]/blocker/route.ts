import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Editing or clearing a blocker is a lightweight, collaborative action —
// anyone signed in can do it, not just the update's original author or an
// admin, since a teammate often notices a blocker is fixed (or has more
// context to add) before the person who logged it does. This intentionally
// bypasses the owner/admin-only RLS on daily_updates, but only ever
// touches the `blockers` field.
//
// Clients included (migration 031): a blocker is project oversight, which is
// theirs to manage. These handlers only ever write the `blockers` column, so
// letting a client through here can't be used to log work.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const text = typeof body.blockers === "string" ? body.blockers.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Blocker text is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("daily_updates").update({ blockers: text }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, blockers: text });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("daily_updates").update({ blockers: "" }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
