import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { MIGRATION_049_MISSING, RESOURCE_LINK_SELECT, isResourcesMissing, parseLinkFields, toResourceLink } from "@/lib/resources";

/**
 * Add a link to the Resources library. Anyone on the team may; marking it the
 * official website is admins only. Both are the table's policies (049) — this
 * route shapes the input and the errors.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseLinkFields(await req.json().catch(() => ({})), { partial: false });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // There's one official website: marking a new one takes the title from the
  // old. Refused for non-admins by the update policy, and their insert below
  // would be refused anyway.
  if (parsed.fields.is_official) {
    await supabase.from("resource_links").update({ is_official: false }).eq("is_official", true);
  }

  const { data, error } = await supabase
    .from("resource_links")
    .insert({ ...parsed.fields, created_by: user.id })
    .select(RESOURCE_LINK_SELECT)
    .single();

  if (error) {
    if (isResourcesMissing(error)) return NextResponse.json({ error: MIGRATION_049_MISSING }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      {
        error: denied
          ? parsed.fields.is_official
            ? "Only admins can set the official website."
            : "You don't have permission to add links."
          : error.message,
      },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ link: toResourceLink(data) });
}
