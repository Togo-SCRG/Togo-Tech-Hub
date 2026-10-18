import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

/**
 * Marks every notification as seen — i.e. "the badge can stop shouting".
 *
 * Deliberately does not touch read_at: seeing that something arrived isn't the
 * same as having dealt with it, and conflating the two would empty the Unread
 * tab the moment anyone opened the bell.
 */
export async function POST() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("seen_at", null)
    .is("archived_at", null);

  if (error) {
    // Column missing means migration 021 hasn't run. Report success anyway:
    // the caller only wants the badge cleared, and on an un-migrated database
    // the badge is driven by read_at instead, which this doesn't touch.
    const notMigrated = error.code === "PGRST204" || error.code === "42703" || /seen_at/.test(error.message);
    if (!notMigrated) {
      console.error(`[notifications/seen] failed: ${error.code} ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
