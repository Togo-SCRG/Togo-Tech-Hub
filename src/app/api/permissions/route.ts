import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { CAPABILITIES } from "@/lib/capabilities";
import type { AccessLevel } from "@/types";

const LEVELS: AccessLevel[] = ["super_admin", "admin", "client", "user"];

/**
 * The whole matrix, as `{ "capability:level": boolean }`.
 *
 * Readable by anyone signed in — the Access Levels page shows the grid to
 * every tier, and only the super admin gets working checkboxes. Missing rows
 * come back false, so a capability that was added to the catalogue but never
 * seeded reads as "off for everyone" rather than throwing.
 */
export async function GET() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.from("permissions").select("capability, access_level, allowed");
  if (error) {
    // The table only exists once migration 032 has run.
    return NextResponse.json({ matrix: {}, available: false });
  }

  const matrix: Record<string, boolean> = {};
  for (const cap of CAPABILITIES) {
    for (const level of LEVELS) {
      matrix[`${cap.key}:${level}`] = level === "super_admin";
    }
  }
  for (const row of data || []) {
    matrix[`${row.capability}:${row.access_level}`] = row.allowed;
  }
  // The super admin is never gated, whatever the table says.
  for (const cap of CAPABILITIES) matrix[`${cap.key}:super_admin`] = true;

  return NextResponse.json({ matrix, available: true });
}

/** Flip one cell. Super admin only — enforced here and by RLS. */
export async function PATCH(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: caller } = await supabase.from("profiles").select("access_level").eq("id", user.id).single();
  if (caller?.access_level !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can change permissions." }, { status: 403 });
  }

  const body = await req.json();
  const { capability, accessLevel, allowed } = body as {
    capability?: string;
    accessLevel?: AccessLevel;
    allowed?: boolean;
  };

  if (!capability || !CAPABILITIES.some((c) => c.key === capability)) {
    return NextResponse.json({ error: "Unknown capability." }, { status: 400 });
  }
  if (!accessLevel || !LEVELS.includes(accessLevel)) {
    return NextResponse.json({ error: "Unknown access level." }, { status: 400 });
  }
  if (typeof allowed !== "boolean") {
    return NextResponse.json({ error: "allowed must be true or false." }, { status: 400 });
  }
  if (accessLevel === "super_admin") {
    return NextResponse.json(
      { error: "The super admin always holds every permission — that's what makes this page recoverable." },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("permissions").upsert(
    {
      capability,
      access_level: accessLevel,
      allowed,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "capability,access_level" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ capability, accessLevel, allowed });
}
