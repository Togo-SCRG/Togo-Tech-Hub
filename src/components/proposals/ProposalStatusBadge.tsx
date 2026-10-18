"use client";

import { ChevronDown } from "lucide-react";
import { PROPOSAL_STATUSES, proposalTone, statusLabel } from "@/lib/proposals";
import { cn } from "@/lib/utils";
import type { ProposalStatus } from "@/types";

const PILL = "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

/** A proposal's status, in the same badge style as project statuses. */
export function ProposalStatusBadge({ status, className }: { status: ProposalStatus; className?: string }) {
  return <span className={cn(PILL, proposalTone(status), className)}>{statusLabel(status)}</span>;
}

/**
 * The status as a picker, tinted in the current status's colour so it still
 * reads as the badge. A native select: keyboard, screen readers and phones all
 * get their own well-worn control for free.
 */
export function ProposalStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProposalStatus;
  onChange: (status: ProposalStatus) => void;
  disabled?: boolean;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProposalStatus)}
        aria-label="Proposal status"
        className={cn(
          "cursor-pointer appearance-none rounded-md border py-1.5 pl-3 pr-8 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-togo-blue disabled:cursor-wait disabled:opacity-60",
          proposalTone(value)
        )}
      >
        {PROPOSAL_STATUSES.map((s) => (
          <option key={s.status} value={s.status}>
            {s.label} — {s.hint}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-70" />
    </span>
  );
}
