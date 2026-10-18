"use client";

import { useState } from "react";
import { IntentLink } from "@/components/ui/IntentLink";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Circle,
  ClipboardList,
  Eye,
  FolderKanban,
  Loader2,
  PauseCircle,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateShort } from "@/lib/utils";

/** One thing behind a number: a project, an update, or an unresolved blocker. */
export interface StatItem {
  id: string;
  project: string;
  /** The update text, or the blocker text. Projects have none. */
  text?: string | null;
  /** Absent for project rows — a project has a team, not an author. */
  authorName?: string;
  status?: string;
  date?: string;
}

/** One choice in a card's period selector. */
export interface StatPeriod {
  key: string;
  /** Selector label — short, it sits in a control a few pixels wide. */
  short: string;
  /** Card label while selected, e.g. "Updates today". */
  label: string;
  value: number;
  delta?: number;
  note?: string;
  items: StatItem[];
  detail: string;
}

export type StatIcon =
  | "updates"
  | "projects"
  | "not-started"
  | "progress"
  | "review"
  | "completed"
  | "hold"
  | "blocked"
  | "blockers";

export interface StatCard {
  key: string;
  label: string;
  value: number;
  /**
   * Any CSS colour value, not a Tailwind class: the status cards take their hue
   * from statusHex() so they match the badges everywhere else, and those are
   * hex strings rather than classes.
   */
  color: string;
  /** Named rather than passed as a component — a server page can't send one. */
  icon: StatIcon;
  delta?: number;
  note?: string;
  /** What the modal lists. */
  items: StatItem[];
  /** Sentence under the modal title, explaining what's counted. */
  detail: string;
  /**
   * "projects" is a flat list — one row per project, so grouping by project
   * would put every row in a group of one. "updates" and "blockers" group,
   * because the useful question there is which projects they belong to.
   */
  kind: "projects" | "updates" | "blockers";
  /** Shown when the count is zero. Cards open at zero too. */
  emptyLabel: string;
  /**
   * Adds a period selector; the card's number, note and list then come from the
   * chosen period rather than the fields above.
   */
  periods?: StatPeriod[];
  /**
   * For a viewer who may not see the list behind the number: the tile renders
   * with no click target. A plain user only ever sees their own work, so the
   * team-wide update list isn't theirs to open.
   */
  noDetail?: boolean;
}

const ICONS: Record<StatIcon, LucideIcon> = {
  updates: ClipboardList,
  projects: FolderKanban,
  "not-started": Circle,
  progress: Loader2,
  review: Eye,
  completed: CheckCircle2,
  hold: PauseCircle,
  blocked: Ban,
  blockers: AlertTriangle,
};

/**
 * The dashboard's stat tiles, each opening the list behind its number.
 *
 * A count on its own raises the question it can't answer — "6 in progress, on
 * what?" — and the answer was three clicks away in the tracker with the right
 * filters applied. Client-side because the page is a server component and the
 * rows are already loaded.
 */
export function StatCards({ cards }: { cards: StatCard[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Keyed by card, so a card with periods keeps its choice while other cards are
  // opened and closed. Defaults to the first period.
  const [periodKey, setPeriodKey] = useState<Record<string, string>>({});

  /** The card as it currently reads, with the period choice folded in. */
  function resolve(card: StatCard): StatCard {
    if (!card.periods?.length) return card;
    const chosen = card.periods.find((p) => p.key === periodKey[card.key]) ?? card.periods[0];
    return {
      ...card,
      label: chosen.label,
      value: chosen.value,
      delta: chosen.delta,
      note: chosen.note,
      items: chosen.items,
      detail: chosen.detail,
    };
  }

  const active = openKey ? cards.map(resolve).find((c) => c.key === openKey) ?? null : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => {
          const s = resolve(card);
          const Icon = ICONS[s.icon];
          const openable = !s.noDetail;
          const periods = card.periods ?? [];
          const selected = periodKey[card.key] ?? periods[0]?.key;

          return (
            // A div, not a button: the period selector is a control of its own,
            // and nesting buttons is invalid HTML. The card-wide click target is
            // an overlay behind the content, with the content non-interactive so
            // clicks fall through — same approach as the blockers card.
            <div
              key={card.key}
              className={cn(
                "card-hover relative rounded-md border border-togo-border bg-togo-surface p-4",
                openable && "hover:border-togo-blue"
              )}
            >
              {openable && (
                <button
                  type="button"
                  onClick={() => setOpenKey(card.key)}
                  aria-label={`See the ${s.label.toLowerCase()}`}
                  title={`See the ${s.label.toLowerCase()}`}
                  className="absolute inset-0 cursor-pointer rounded-md"
                />
              )}

              <div className="pointer-events-none relative mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium uppercase tracking-widest text-togo-faint">
                  {s.label}
                </span>
                <Icon size={13} className="shrink-0 text-togo-faint" />
              </div>

              <div
                className="pointer-events-none relative tnum text-3xl font-extrabold leading-none"
                style={{ color: s.color }}
              >
                {s.value}
              </div>

              {periods.length > 0 && (
                <div
                  role="group"
                  aria-label={`${card.label} period`}
                  // pointer-events-auto so these sit above the card-wide target.
                  className="pointer-events-auto relative mt-2 inline-flex items-center gap-0.5 rounded border border-togo-border bg-togo-surface-2 p-0.5"
                >
                  {periods.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={selected === p.key}
                      onClick={() => setPeriodKey((prev) => ({ ...prev, [card.key]: p.key }))}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                        selected === p.key
                          ? "bg-togo-surface text-togo-white"
                          : "text-togo-faint hover:text-togo-white"
                      )}
                    >
                      {p.short}
                    </button>
                  ))}
                </div>
              )}

              {s.delta !== undefined ? (
                <div className="pointer-events-none relative mt-2 flex items-center gap-1 text-[10px]">
                  {s.delta === 0 ? (
                    <span className="text-togo-muted">Same as yesterday</span>
                  ) : (
                    <>
                      {s.delta > 0 ? (
                        <TrendingUp size={11} className="text-[var(--status-completed-fg)]" />
                      ) : (
                        <TrendingDown size={11} className="text-[var(--status-hold-fg)]" />
                      )}
                      <span
                        className={
                          s.delta > 0 ? "text-[var(--status-completed-fg)]" : "text-[var(--status-hold-fg)]"
                        }
                      >
                        {Math.abs(s.delta)}
                      </span>
                      <span className="text-togo-faint">vs yesterday</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="pointer-events-none relative mt-2 text-[10px] text-togo-muted">{s.note}</div>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={!!active} onClose={() => setOpenKey(null)} title={active?.label ?? ""} className="max-w-2xl">
        {active && (
          <div className="space-y-4">
            <p className="text-xs text-togo-muted">{active.detail}</p>

            {active.items.length === 0 ? (
              <EmptyState icon={ICONS[active.icon]} title={active.emptyLabel} className="border-0 bg-transparent" />
            ) : active.kind === "projects" ? (
              <ul className="max-h-[55vh] divide-y divide-togo-border overflow-y-auto rounded-md border border-togo-border">
                {active.items.map((item) => (
                  <li key={item.id}>
                    <IntentLink
                      href={`/projects/${encodeURIComponent(item.project)}`}
                      className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--togo-hover)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-togo-white">
                        {item.project}
                      </span>
                      {item.status && <StatusBadge status={item.status} />}
                      {item.date && (
                        <span className="tnum shrink-0 text-[10px] text-togo-faint">{formatDateShort(item.date)}</span>
                      )}
                      <ArrowRight size={12} className="shrink-0 text-togo-faint" />
                    </IntentLink>
                  </li>
                ))}
              </ul>
            ) : (
              // Grouped by project: the question these cards raise is "which
              // projects?", so the project is the heading rather than a column
              // repeated down every row.
              <ul className="max-h-[55vh] space-y-3 overflow-y-auto">
                {groupByProject(active.items).map(([project, items]) => (
                  <li key={project} className="overflow-hidden rounded-md border border-togo-border">
                    <div className="flex items-center justify-between gap-2 border-b border-togo-border bg-togo-surface-2/40 px-3 py-2">
                      <IntentLink
                        href={`/projects/${encodeURIComponent(project)}`}
                        className="flex items-center gap-1.5 truncate text-xs font-bold text-togo-white transition-colors hover:text-togo-blue"
                      >
                        {project}
                        <ArrowRight size={11} className="shrink-0 text-togo-faint" />
                      </IntentLink>
                      <span className="tnum shrink-0 rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
                        {items.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-togo-border">
                      {items.map((item) => (
                        <li key={item.id} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {item.authorName && (
                              <span className="text-[11px] font-semibold text-togo-white">{item.authorName}</span>
                            )}
                            {item.status && <StatusBadge status={item.status} />}
                            {item.date && (
                              <span className="tnum ml-auto text-[10px] text-togo-faint">
                                {formatDateShort(item.date)}
                              </span>
                            )}
                          </div>
                          {item.text?.trim() && (
                            <p
                              className={cn(
                                "mt-1 whitespace-pre-line text-[11px] leading-snug",
                                active.icon === "blockers" ? "text-[var(--status-blocked-fg)]" : "text-togo-muted"
                              )}
                            >
                              {item.text.trim()}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

/** Stable order: most items first, then alphabetical, so it doesn't reshuffle. */
function groupByProject(items: StatItem[]): [string, StatItem[]][] {
  const groups = new Map<string, StatItem[]>();
  for (const item of items) {
    const list = groups.get(item.project);
    if (list) list.push(item);
    else groups.set(item.project, [item]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
