"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { AddProjectMemberModal } from "@/components/projects/AddProjectMemberModal";
import { useToast } from "@/components/ui/Toast";
import { formatMinutes } from "@/lib/utils";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";

interface Participant {
  userId: string;
  memberProjectId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /**
   * This person's own status for the project. No longer shown here: the panel
   * lists who is on the project, and one status per person alongside the
   * project's single status in the header read as a contradiction. Still on the
   * type because the Projects list uses it as a fallback for projects with no
   * settings row.
   */
  status: string;
  partnerIds: string[];
}

/** Compact team roster for the project sidebar. */
export function ProjectTeamSection({
  participants,
  minutesByUser,
  totalMinutes,
  projectName,
}: {
  participants: Participant[];
  minutesByUser: Record<string, number>;
  totalMinutes: number;
  projectName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { currentUser } = useCurrentUser();
  const canAssign = can(currentUser?.capabilities, "project.assign");
  const canUnassign = can(currentUser?.capabilities, "project.unassign");
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Busiest contributor first — answers "who is actually on this?" fastest.
  const ordered = useMemo(
    () => [...participants].sort((a, b) => (minutesByUser[b.userId] || 0) - (minutesByUser[a.userId] || 0)),
    [participants, minutesByUser]
  );

  async function handleRemove() {
    if (!removeTarget?.memberProjectId) return;
    setRemoving(true);
    setError(null);
    const removedName = removeTarget.name;
    const res = await fetch(`/api/member-projects/${removeTarget.memberProjectId}`, { method: "DELETE" });
    if (res.ok) {
      setRemoveTarget(null);
      router.refresh();
      toast.success(`${removedName} removed from this project.`);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to remove this member from the project.");
    }
    setRemoving(false);
  }

  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
        <h2 className="text-sm font-bold text-togo-white">Team</h2>
        <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
          {participants.length}
        </span>
        {/* Open to every signed-in member, not just admins (migration 022) —
            staffing a project you're working on shouldn't need an admin.
            Removing someone is still admin-only. */}
        {canAssign && (
          <button
            onClick={() => setAddOpen(true)}
            title="Add someone to this project"
            className="ml-auto flex items-center gap-1 rounded border border-togo-border px-1.5 py-0.5 text-[10px] font-medium text-togo-blue transition-colors hover:border-togo-blue"
          >
            <UserPlus size={11} /> Add
          </button>
        )}
      </div>

      {participants.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-xs text-togo-muted">
            Nobody assigned yet. People appear here once they&apos;re assigned or log an update.
          </p>
          {canAssign && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAddOpen(true)}>
              <UserPlus size={13} /> Add someone
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-togo-border">
          {ordered.map((p) => {
            // Removing yourself is always allowed, which is why the
            // capability is only consulted for other people.
            const canRemove =
              !!p.memberProjectId && (canUnassign || currentUser?.id === p.userId);
            const minutes = minutesByUser[p.userId] || 0;
            return (
              <li key={p.userId} className="group flex items-center gap-2.5 px-4 py-2.5">
                <Link
                  href={`/members/${p.userId}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-togo-blue"
                >
                  <Avatar name={p.name} avatarUrl={p.avatarUrl} size="sm" className="shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-togo-white">{p.name}</div>
                    {/* The project role was in the data all along but never
                        rendered — it's the most useful thing on this row. */}
                    <div className="truncate text-[11px] text-togo-muted">
                      {p.role || (p.memberProjectId ? "No role set" : "From logged updates")}
                    </div>
                  </div>
                </Link>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    {canRemove && (
                      <button
                        onClick={() => setRemoveTarget(p)}
                        title={`Remove ${p.name} from this project`}
                        aria-label={`Remove ${p.name} from this project`}
                        className="rounded p-0.5 text-[var(--status-blocked-fg)] opacity-0 transition-all hover:bg-[var(--status-blocked-bg)] focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  {minutes > 0 && <span className="tnum text-[10px] text-togo-faint">{formatMinutes(minutes)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-togo-border px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-togo-muted">Time logged</span>
          <span className="tnum font-semibold text-togo-white">
            {totalMinutes > 0 ? formatMinutes(totalMinutes) : "None yet"}
          </span>
        </div>
        <ProgressBar
          value={totalMinutes > 0 ? 100 : 0}
          label={`${formatMinutes(totalMinutes)} logged against this project`}
          className="h-1"
        />
      </div>

      {canAssign && (
        <AddProjectMemberModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdded={() => router.refresh()}
          projectName={projectName}
          existingUserIds={participants.map((p) => p.userId)}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove From Project"
        description={`Remove ${removeTarget?.name} from this project? Their logged updates and time entries stay intact — this only removes them from the Team list.${
          error ? ` ${error}` : ""
        }`}
        confirmLabel="Remove"
        danger
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => {
          setRemoveTarget(null);
          setError(null);
        }}
      />
    </section>
  );
}
