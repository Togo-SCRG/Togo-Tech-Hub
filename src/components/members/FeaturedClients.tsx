"use client";

import Link from "next/link";
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
        <h2 className="text-lg font-bold text-togo-white">Featured Clients</h2>
        {action}
      </div>

      {clients.length === 0 ? (
        <div className="bg-togo-surface border border-togo-border rounded-md p-6 text-center text-togo-muted text-sm">
          No featured clients yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/members/${c.id}`}
              className="relative bg-togo-charcoal border border-togo-border rounded-md p-5 flex items-center gap-4 hover:border-togo-blue transition-colors flex-1 min-w-[240px]"
            >
              {canManage && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(c);
                  }}
                  title="Manage client account"
                  className="absolute top-3 right-3 text-togo-faint hover:text-togo-blue transition-colors"
                >
                  <Pencil size={15} />
                </button>
              )}
              <Avatar name={c.name} avatarUrl={c.avatarUrl} size="lg" className="shrink-0" />
              {/* Name leads, title supports it — these were the other way round,
                  which read as though the job title were the person. */}
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-lg font-extrabold leading-tight text-togo-white">
                  {toNameCase(c.name)}
                </p>
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-togo-muted">{c.role}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
