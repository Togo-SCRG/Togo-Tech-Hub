import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { RESOURCE_LINK_SELECT, parseLinkFields, toResourceLink } from "@/lib/resources";

// The link policies (049) decide who may: whoever added it, or an admin. A
// refused update or delete matches no rows rather than erroring, so "nothing
// changed" is reported as not allowed.

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseLinkFields(await req.json().catch(() => ({})), { partial: true });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (Object.keys(parsed.fields).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // One official website: this one takes the title from whichever had it.
  if (parsed.fields.is_official) {
    await supabase.from("resource_links").update({ is_official: false }).eq("is_official", true).neq("id", params.id);
  }

  const { data, error } = await supabase
    .from("resource_links")
    .update(parsed.fields)
    .eq("id", params.id)
    .select(RESOURCE_LINK_SELECT)
    .maybeSingle();

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "Only admins can set the official website." : error.message },
      { status: denied ? 403 : 400 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "You can only edit links you added." }, { status: 403 });
  }

  return NextResponse.json({ link: toResourceLink(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error, count } = await supabase.from("resource_links").delete({ count: "exact" }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!count) {
    return NextResponse.json({ error: "You can only remove links you added." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
