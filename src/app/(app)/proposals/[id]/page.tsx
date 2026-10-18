import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/capabilities";
import { fetchProposal } from "@/lib/proposals";
import { BackButton } from "@/components/layout/BackButton";
import { ProposalDetail } from "@/components/proposals/ProposalDetail";
import { NoProposalAccess } from "@/components/proposals/NoProposalAccess";

export default async function ProposalPage({ params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me?.proposalRole) return <NoProposalAccess previewing={!!me?.viewingAs} />;

  // Not a uuid → can't be a proposal; skip the query rather than send Postgres
  // something it will reject with an error.
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const found = await fetchProposal(createClient(), params.id);
  if (!found) notFound();

  return (
    <div className="w-full">
      <BackButton label="Back to proposals" fallbackHref="/proposals" />
      {/* Keyed so moving between proposals starts each one fresh. */}
      <ProposalDetail
        key={found.proposal.id}
        initialProposal={found.proposal}
        initialDocuments={found.documents}
        activity={found.activity}
        canManage={me.proposalRole === "manager"}
        canCreateProject={can(me.capabilities, "project.create")}
        currentUserId={me.id}
      />
    </div>
  );
}
