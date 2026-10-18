import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * What someone without proposal access sees if they reach a proposals URL
 * directly — the nav doesn't offer it. The database would return nothing to
 * them anyway; this just says why.
 */
export function NoProposalAccess({ previewing }: { previewing?: boolean }) {
  return (
    <EmptyState
      icon={Lock}
      title="Proposals are restricted"
      description={
        previewing
          ? "Access to proposals is given to people individually, so a preview of an access level doesn't include it. Exit “View as” to see proposals."
          : "Only people the super admin has given access can see proposals. Ask them if you need it."
      }
    />
  );
}
