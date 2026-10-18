import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/capabilities";
import { fetchHubFiles, fetchResourceLinks, fetchSourcedLinks } from "@/lib/resources";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResourcesView, type ResourcesTab } from "@/components/resources/ResourcesView";

export default async function ResourcesPage({ searchParams }: { searchParams: { tab?: string } }) {
  // Cached from the layout's lookup, so it costs nothing.
  const me = await getCurrentUser();

  // The team's library — internal systems and files, not for clients. The
  // database refuses them too (049); this just says why.
  if (!me || me.isClient) {
    return (
      <EmptyState
        icon={Lock}
        title="Resources are for the team"
        description="The team's shared files and links aren't available on client accounts."
      />
    );
  }

  const supabase = createClient();
  const canSeeProposals = !!me.proposalRole;
  const [{ ready, links }, sourcedLinks, { files }] = await Promise.all([
    fetchResourceLinks(supabase),
    // Every link in project and proposal notes, overviews and summaries.
    fetchSourcedLinks(supabase, { includeProposals: canSeeProposals }),
    fetchHubFiles(supabase, { includeProposals: canSeeProposals }),
  ]);

  const initialTab: ResourcesTab = searchParams.tab === "links" ? "links" : "files";

  return (
    <ResourcesView
      initialTab={initialTab}
      initialLinks={links}
      sourcedLinks={sourcedLinks}
      initialFiles={files}
      ready={ready}
      me={{
        id: me.id,
        isAdmin: me.isAdmin || me.isSuperAdmin,
        canEditProjectDocs: can(me.capabilities, "project.docs.edit"),
        canManageProposals: me.proposalRole === "manager",
      }}
    />
  );
}
