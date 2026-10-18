"use client";

import { IntentLink } from "@/components/ui/IntentLink";
import { ArrowRight, FolderKanban } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/usePagination";
import { statusHex, statusProgress } from "@/lib/utils";

export interface ActiveProjectRow {
  name: string;
  status: string;
}

/**
 * The dashboard's project list, paginated.
 *
 * Was every project in one scrolling column, which on a hub with twenty of them
 * made the right-hand side several times taller than the updates table next to
 * it. Client-side paging because the page is a server component and the rows are
 * already loaded — turning a page shouldn't cost a round trip.
 *
 * No fixed height: the panel is exactly as tall as the rows it's showing. A
 * fixed ten-row box clipped the tenth row into a scrollbar, and any height that
 * tried to match the updates table beside it left dead space under the
 * pagination whenever the two lists differed in length — which is most of the
 * time, since they count different things.
 */
export function ActiveProjectsPanel({ projects }: { projects: ActiveProjectRow[] }) {
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, paged } = usePagination(projects);

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center justify-between border-b border-togo-border px-4 py-2.5">
        <span className="text-xs font-medium text-togo-muted">Active projects</span>
        <IntentLink
          href="/projects"
          className="flex items-center gap-1 text-[11px] text-togo-faint transition-colors hover:text-togo-blue"
        >
          All <ArrowRight size={11} />
        </IntentLink>
      </div>

      <div>
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Projects appear here as soon as work is logged against them."
            className="h-full justify-center border-0 bg-transparent px-4 py-8"
          />
        ) : (
          paged.map((p) => (
            <IntentLink
              key={p.name}
              href={`/projects/${encodeURIComponent(p.name)}`}
              className="flex items-center gap-2 border-t border-togo-border px-4 py-2 transition-colors hover:bg-[var(--togo-hover)]"
            >
              <span className="flex-1 truncate text-xs text-togo-white" title={p.name}>
                {p.name}
              </span>
              <ProgressBar
                value={statusProgress(p.status)}
                color={statusHex(p.status)}
                label={`${p.name}: ${p.status}`}
                className="h-1.5 w-20 shrink-0"
              />
              <span className="tnum w-7 shrink-0 text-right text-[10px] text-togo-faint">
                {statusProgress(p.status)}%
              </span>
              <StatusBadge status={p.status} />
            </IntentLink>
          ))
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        // compact: the full row (count + page jump + size) doesn't fit the 400px
        // sidebar — it clipped the size selector off the right edge.
        compact
        className="border-t border-togo-border px-4 py-2.5"
      />
    </div>
  );
}
