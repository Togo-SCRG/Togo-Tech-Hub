"use client";

import { IntentLink } from "@/components/ui/IntentLink";
import { Pencil } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { toNameCase } from "@/lib/utils";
import type { ClientItem } from "@/types";

// "Add Client" deliberately isn't here — it sits next to "Add member" on the
// search row below, since the two do the same thing (provision an account) and
// were previously two separate buttons in two separate places.
export function FeaturedClients({
  clients,
  canManage,
  onEdit,
  action,
}: {
  clients: ClientItem[];
  canManage: boolean;
  onEdit: (client: ClientItem) => void;
  /**
   * Rendered opposite the heading. Passed in rather than owned here because
   * "Assign Project" has nothing to do with clients — it just belongs on this
   * row, and a lone button on a row of its own above the heading read as a
   * layout accident.
   */
  action?: React.ReactNode;
}) {
  if (clients.length === 0 && !canManage) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-togo-white">Featured Clients</h2>
          {clients.length > 0 && (
            <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
              {clients.length}
            </span>
          )}
        </div>
        {action}
      </div>

      {clients.length === 0 ? (
        <div className="bg-togo-surface border border-togo-border rounded-md p-6 text-center text-togo-muted text-sm">
          No featured clients yet.
        </div>
      ) : (
        /* A grid, not a wrapping flex row: with flex-1 cards, whatever didn't
           fit the first row stretched to fill the second, so the same card came
           out twice as wide depending on how many clients there were. */
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const name = toNameCase(c.name);
            return (
              <li key={c.id} className="group relative">
                <IntentLink
                  href={`/members/${c.id}`}
                  className="card-hover flex h-full items-center gap-3 rounded-md border border-togo-border bg-togo-surface p-4 hover:border-togo-blue"
                >
                  <Avatar name={c.name} avatarUrl={c.avatarUrl} size="md" className="!h-12 !w-12 !text-base shrink-0" />
                  {/* Name leads, title supports it. The title gets two lines
                      rather than one: job titles run long ("Vice President of
                      Operations") and cutting them to "VICE PRESIDENT…" lost the
                      part that says what the person does. pr-6 keeps text clear
                      of the edit button. */}
                  <div className="min-w-0 flex-1 pr-6">
                    <p className="truncate text-[15px] font-bold leading-tight text-togo-white" title={name}>
                      {name}
                    </p>
                    {c.role && (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-togo-muted" title={c.role}>
                        {c.role}
                      </p>
                    )}
                  </div>
                </IntentLink>

                {/* A sibling of the link rather than inside it — a button
                    nested in a link is invalid markup and needed
                    preventDefault to stop the click from navigating. Shown on
                    hover or focus; always on touch screens, which can't hover. */}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onEdit(c)}
                    title="Manage client account"
                    aria-label={`Manage ${name}'s client account`}
                    className="absolute right-2 top-2 rounded p-1.5 text-togo-faint transition hover:bg-togo-surface-2 hover:text-togo-blue focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
