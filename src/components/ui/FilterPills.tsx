"use client";

import { cn } from "@/lib/utils";

export interface FilterPill {
  label: string;
  value: string;
}

// The status filter row shared by the tracker and projects pages. Each pill
// carries a live count so you can see how the work splits across statuses
// *before* clicking — and a pill whose count is 0 is dimmed rather than
// hidden, so the set of options never shifts around under the cursor.
export function FilterPills({
  pills,
  value,
  onChange,
  counts,
  toneFor,
  stretch,
  label = "Filter by status",
  className,
}: {
  pills: FilterPill[];
  value: string;
  onChange: (value: string) => void;
  counts?: Record<string, number>;
  /**
   * Colour classes for a pill, e.g. `statusTone` so each status tab wears its
   * badge's colour. Pills it returns nothing for (like "All") keep the default
   * look. A toned pill shows it's selected with a ring in its own colour rather
   * than a solid fill — white text on the dark theme's light green or amber
   * would be hard to read.
   */
  toneFor?: (value: string) => string | undefined;
  /**
   * Pills grow to fill the row, so its edges line up with a full-width list
   * underneath instead of the last pill stopping short of the right edge.
   */
  stretch?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {pills.map((p) => {
        const active = value === p.value;
        const count = counts?.[p.value];
        const empty = count === 0 && !active;
        const tone = toneFor?.(p.value);
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-[color,background-color,border-color,box-shadow,filter]",
              stretch ? "flex-1 justify-center whitespace-nowrap px-2.5" : "px-3",
              tone
                ? cn(tone, active ? "font-semibold ring-2 ring-current" : "hover:brightness-95 dark:hover:brightness-125")
                : active
                  ? "border-togo-blue bg-togo-blue text-white"
                  : "border-togo-border bg-togo-surface-2 text-togo-muted hover:border-togo-border-strong hover:text-togo-white",
              empty && "opacity-50"
            )}
          >
            {p.label}
            {count !== undefined && (
              <span
                className={cn(
                  "tnum rounded px-1 text-[10px] font-semibold leading-4",
                  // A toned pill's count takes the pill's own colour on a faint
                  // wash, so it reads as part of the same badge.
                  tone
                    ? "bg-black/[0.06] dark:bg-white/10"
                    : active
                      ? "bg-white/25 text-white"
                      : "bg-togo-border text-togo-muted"
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
