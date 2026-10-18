import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchProposalLinks, fetchProposals } from "@/lib/proposals";
import { fetchProposalGrantees } from "@/lib/proposalPeople";
import { ProposalsView } from "@/components/proposals/ProposalsView";
import { NoProposalAccess } from "@/components/proposals/NoProposalAccess";

export default async function ProposalsPage() {
  // Cached from the layout's lookup, so it costs nothing.
  const me = await getCurrentUser();
  if (!me?.proposalRole) return <NoProposalAccess previewing={!!me?.viewingAs} />;

  const supabase = createClient();
  const [{ ready, proposals }, links, grantable] = await Promise.all([
    fetchProposals(supabase),
    fetchProposalLinks(supabase),
    // Only the super admin manages access, so only they need the list.
    me.isSuperAdmin ? fetchProposalGrantees(supabase) : Promise.resolve([]),
  ]);

  return (
    <ProposalsView
      proposals={proposals}
      links={links}
      ready={ready}
      canManage={me.proposalRole === "manager"}
      isSuperAdmin={me.isSuperAdmin}
      grantable={grantable}
    />
  );
}
