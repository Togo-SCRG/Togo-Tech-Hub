import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { MIGRATION_045_MISSING, PROPOSAL_SELECT, isProposalsMissing, parseProposalFields, toProposal } from "@/lib/proposals";

/**
 * Create a proposal. Managers only — decided by the table's insert policy
 * (migration 045), which is also what keeps everyone without access out of the
 * reads; this route only shapes the input and the errors.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = parseProposalFields(body, { partial: false });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("proposals")
    .insert({ ...parsed.fields, created_by: user.id })
    .select(PROPOSAL_SELECT)
    .single();

  if (error) {
    if (isProposalsMissing(error)) return NextResponse.json({ error: MIGRATION_045_MISSING }, { status: 400 });
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to create proposals." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ proposal: toProposal(data) });
}
