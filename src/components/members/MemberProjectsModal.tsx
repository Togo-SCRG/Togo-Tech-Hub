"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FolderKanban } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { FilterPills } from "@/components/ui/FilterPills";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { IntentLink } from "@/components/ui/IntentLink";
import type { MemberProjectSummary } from "@/types";

// Live work first, finished work last — the order the list is read in when
// someone asks "what is this person on right now?".
const STATUS_ORDER = ["In Progress", "Review", "Blocked", "On Hold", "Not Started", "Completed"];

const PILLS = [
  { label: "All", value: "all" },
  { label: "In progress", value: "In Progress" },
  { label: "Review", value: "Review" },
  { label: "Blocked", value: "Blocked" },
  { label: "On hold", value: "On Hold" },
  { label: "Not started", value: "Not Started" },
  { label: "Completed", value: "Completed" },
];

function rank(status: string) {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length : i;
}

/**
 * Everything one person is on, split by status. The roster only has room for a
 * count; this is where the names and their state live, one click away.
 */
export function MemberProjectsModal({
  open,
  onClose,
  member,
}: {
  open: boolean;
  onClose: () => void;
  member: { name: string; avatarUrl: string | null; projects: MemberProjectSummary[] } | null;
}) {
  const [status, setStatus] = useState("all");

  const projects = useMemo(
    () =>
      [...(member?.projects ?? [])].sort(
        (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)
      ),
    [member]
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: projects.length };
    for (const pill of PILLS) {
      if (pill.value !== "all") result[pill.value] = projects.filter((p) => p.status === pill.value).length;
    }
    return result;
  }, [projects]);

  if (!member) return null;

  const shown = status === "all" ? projects : projects.filter((p) => p.status === status);
  const label = PILLS.find((p) => p.value === status)?.label.toLowerCase();

  return (
    // Between the cramped max-w-xl and an over-wide 4xl.
    <Modal open={open} onClose={onClose} title={`${member.name}'s projects`} className="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={member.name} avatarUrl={member.avatarUrl} size="md" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-togo-white">{member.name}</p>
            <p className="tnum text-xs text-togo-muted">
              {projects.length} {projects.length === 1 ? "project" : "projects"}
              {counts["Completed"] > 0 && ` · ${counts["Completed"]} completed`}
            </p>
          </div>
        </div>

        {/* Each tab in its status's badge colour, so a tab and the badges it
            filters to read as the same thing. */}
        <FilterPills
          pills={PILLS}
          value={status}
          onChange={setStatus}
          counts={counts}
          toneFor={statusTone}
          stretch
          label="Filter projects by status"
        />

        {shown.length === 0 ? (
          <p className="rounded-md border border-dashed border-togo-border px-4 py-8 text-center text-sm text-togo-faint">
            {projects.length === 0 ? `${member.name} isn't on any projects yet.` : `No ${label} projects.`}
          </p>
        ) : (
          /* Scrolls on its own so the tabs stay put on a long list. */
          <ul className="max-h-[55vh] divide-y divide-togo-border overflow-y-auto rounded-md border border-togo-border">
            {shown.map((p) => (
              <li key={p.name}>
                <IntentLink
                  href={`/projects/${encodeURIComponent(p.name)}`}
                  onClick={onClose}
                  className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--togo-hover)]"
                >
                  <FolderKanban size={15} className="shrink-0 text-togo-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-togo-white transition-colors group-hover:text-togo-blue" title={p.name}>
                    {p.name}
                  </span>
                  <StatusBadge status={p.status} />
                  <ChevronRight size={14} className="shrink-0 text-togo-faint" />
                </IntentLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
