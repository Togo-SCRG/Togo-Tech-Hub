"use client";

import { Calendar, FolderKanban, Zap } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { formatDate } from "@/lib/utils";
import { isRealBlocker } from "@/lib/blockers";
import type { DailyUpdateItem } from "@/types";

/**
 * A logged update, read-only.
 *
 * Opening a row used to be edit-or-nothing, which left anyone who can't edit a
 * given row — a client, or a user looking at a teammate's work — with a table
 * of truncated cells and no way to read the rest. This shows the whole thing
 * without offering a single control that would fail on save.
 */
export function UpdateDetailModal({
  open,
  onClose,
  update,
}: {
  open: boolean;
  onClose: () => void;
  update: DailyUpdateItem | null;
}) {
  if (!update) return null;
  const WorkIcon = update.workType === "task" ? Zap : FolderKanban;

  return (
    <Modal open={open} onClose={onClose} title="Update details" className="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={update.user.name} avatarUrl={update.user.avatarUrl} size="md" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-togo-white">{update.user.name}</p>
            <p className="truncate text-xs text-togo-muted">{update.user.role}</p>
          </div>
          <StatusBadge status={update.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-togo-border bg-togo-surface-2/40 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-togo-white">
            <WorkIcon size={13} className="shrink-0 text-togo-faint" />
            {update.project}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-togo-muted">
            <Calendar size={13} className="shrink-0 text-togo-faint" />
            {formatDate(update.date)}
          </span>
        </div>

        <Field label="Update">{update.update}</Field>
        <Field label="What's left to do">{update.whatsLeft}</Field>
        {/* `danger` only when something actually is blocking — a "N/A" answer
            tinted red reads as a problem when it says the opposite. */}
        <Field label="Concerns / blockers" danger={isRealBlocker(update.blockers)}>
          {update.blockers}
        </Field>

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * `whitespace-pre-line` because these are bullet lists typed with real
 * newlines — collapsing them would run every bullet into one paragraph.
 * Links are clickable, and a long unbroken string (usually a pasted URL) wraps
 * instead of pushing the modal wider.
 */
function Field({
  label,
  children,
  danger,
}: {
  label: string;
  children?: string | null;
  danger?: boolean;
}) {
  const text = children?.trim();
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-togo-faint">{label}</p>
      {text ? (
        <p
          className={
            danger
              ? "whitespace-pre-line text-sm leading-relaxed text-[var(--status-blocked-fg)] [overflow-wrap:anywhere]"
              : "whitespace-pre-line text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]"
          }
        >
          <LinkifiedText text={text} />
        </p>
      ) : (
        <p className="text-sm italic text-togo-faint">Nothing recorded</p>
      )}
    </div>
  );
}
