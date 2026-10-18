"use client";

import { cn, nextStatus, STATUS_OPTIONS } from "@/lib/utils";

/**
 * The label every badge is sized to. Longest by character count, which for this
 * set is "In Progress" / "Not Started" — if one of them renders a hair wider
 * than the other it will expand past this, so keep new statuses no longer.
 */
const WIDEST_STATUS = [...STATUS_OPTIONS].sort((a, b) => b.length - a.length)[0];

// Compact pill: tinted background + saturated text + hairline border.
// Tints come from CSS variables so they adapt to light/dark themes.
const STATUS_STYLES: Record<string, string> = {
  "Not Started": "bg-togo-surface-2 text-togo-faint border-togo-border",
  "In Progress":
    "bg-[var(--status-progress-bg)] text-[#0797DF] border-[var(--status-progress-border)]",
  Review:
    "bg-[var(--status-review-bg)] text-[var(--status-review-fg)] border-[var(--status-review-border)]",
  Completed:
    "bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)] border-[var(--status-completed-border)]",
  "On Hold":
    "bg-[var(--status-hold-bg)] text-[var(--status-hold-fg)] border-[var(--status-hold-border)]",
  Blocked:
    "bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)] border-[var(--status-blocked-border)]",
};

/**
 * The badge's colour classes for a status (tint, text, border), for anything
 * else that stands for a status — e.g. status filter tabs — so it reads in the
 * same colour as the badges it filters. Undefined for an unknown status.
 */
export function statusTone(status: string): string | undefined {
  return STATUS_STYLES[status];
}

export function StatusBadge({
  status,
  onClick,
  className,
}: {
  status: string;
  onClick?: (next: string) => void;
  className?: string;
}) {
  const style = STATUS_STYLES[status] || STATUS_STYLES["On Hold"];

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(nextStatus(status));
      }}
      className={cn(
        "relative inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border",
        onClick && "cursor-pointer hover:opacity-80 transition-opacity",
        !onClick && "cursor-default",
        style,
        className
      )}
      title={onClick ? "Click to change status" : undefined}
    >
      {/* Sizer: an invisible copy of the longest label sets the width, so every
          badge is exactly as wide as "In Progress" — measured in the real font
          rather than guessed at in pixels, so it holds across fonts and zoom.
          The visible label is overlaid on top and centred. */}
      <span aria-hidden className="invisible">
        {WIDEST_STATUS}
      </span>
      <span className="absolute inset-0 flex items-center justify-center">{status}</span>
    </button>
  );
}
