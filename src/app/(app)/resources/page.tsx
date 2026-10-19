import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/capabilities";
import { fetchHubFiles, fetchResourceLinks, fetchSourcedLinks } from "@/lib/resources";
import { ResourcesView, type ResourcesTab } from "@/components/resources/ResourcesView";

export default async function ResourcesPage({ searchParams }: { searchParams: { tab?: string } }) {
  // Cached from the layout's lookup, so it costs nothing. Everyone signed in
  // may use Resources, clients included (051).
  const me = await getCurrentUser();
  if (!me) redirect("/login");

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
        canEditProjectDocs: can(me.capabilities, "project.docs.edit"),
        canManageProposals: me.proposalRole === "manager",
      }}
    />
  );
}
