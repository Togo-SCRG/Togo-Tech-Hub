import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSideNote } from "@/lib/schemaSupport";

function toCamel(data: {
  project: string;
  weekly_hour_cap: number | null;
  overview: string | null;
  prd: string | null;
  timeline: string | null;
  status: string;
  side_note?: string | null;
}) {
  return {
    project: data.project,
    weeklyHourCap: data.weekly_hour_cap,
    overview: data.overview,
    prd: data.prd,
    timeline: data.timeline,
    status: data.status,
    sideNote: data.side_note ?? null,
  };
}

export async function GET(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project is required." }, { status: 400 });
  }

  // `*` rather than a column list: naming side_note here made this endpoint fail
  // outright before migration 039 was run, which took the weekly hour cap, the
  // timeline and the overview down with it. With `*` a column that isn't there
  // yet simply comes back undefined.
  const { data, error } = await supabase
    .from("project_settings")
    .select("*")
    .eq("project", project)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: toCamel(
      data || {
        project,
        weekly_hour_cap: null,
        overview: null,
        prd: null,
        timeline: null,
        status: "Not Started",
        side_note: null,
      }
    ),
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { project, weeklyHourCap, overview, prd, timeline, status, sideNote } = body;
  if (!project) {
    return NextResponse.json({ error: "project is required." }, { status: 400 });
  }

  const upsertData: Record<string, unknown> = { project };
  if (weeklyHourCap !== undefined) upsertData.weekly_hour_cap = weeklyHourCap;
  if (overview !== undefined) upsertData.overview = overview;
  if (prd !== undefined) upsertData.prd = prd;
  if (timeline !== undefined) upsertData.timeline = timeline;
  if (status !== undefined) upsertData.status = status;
  if (sideNote !== undefined) {
    // Reported rather than silently dropped: someone who typed a note and saw
    // "Saved" would reasonably assume it was stored.
    if (!(await hasSideNote(supabase))) {
      return NextResponse.json(
        { error: "Side notes aren't set up yet — run migration 039 in Supabase." },
        { status: 400 }
      );
    }
    upsertData.side_note = sideNote;
  }

  const { data, error } = await supabase
    .from("project_settings")
    .upsert(upsertData, { onConflict: "project" })
    .select("*")
    .single();

  if (error) {
    const denied = error.code === "42501";
    // Overview/PRD are open to everyone; status and timeline need membership
    // and the weekly cap stays admin-only. A trigger rejects those and names
    // the reason (migration 028), so pass its message through rather than
    // flattening every denial to one generic line.
    return NextResponse.json(
      { error: denied ? error.message || "You don't have permission to change that." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ settings: toCamel(data) });
}
