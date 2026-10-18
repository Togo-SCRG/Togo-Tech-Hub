"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, FileText, Handshake, Plus, SearchX, Send, ShieldCheck, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPills } from "@/components/ui/FilterPills";
import { IntentLink } from "@/components/ui/IntentLink";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { ProposalStatusBadge } from "@/components/proposals/ProposalStatusBadge";
import { ProposalFormModal } from "@/components/proposals/ProposalFormModal";
import { ProposalAccessModal } from "@/components/proposals/ProposalAccessModal";
import { LinkListCell } from "@/components/ui/LinkListCell";
import {
  PROPOSAL_STATUSES,
  formatMoney,
  formatWeeks,
  isClosedProposal,
  isOpenProposal,
  proposalTone,
  totalWeeks,
} from "@/lib/proposals";
import { usePagination } from "@/lib/usePagination";
import { useSort } from "@/lib/useSort";
import { timeAgo } from "@/lib/utils";
import type { PersonRef, Proposal, ProposalLinks } from "@/types";

type SortKey = "title" | "status" | "value" | "build" | "updated";

const STATUS_RANK = new Map(PROPOSAL_STATUSES.map((s, i) => [s.status, i]));

// "Open" and "Closed" group the statuses either side of the outcome; the
// statuses themselves follow.
const PILLS = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Closed", value: "closed" },
  ...PROPOSAL_STATUSES.map((s) => ({ label: s.label, value: s.status })),
];

function matchesStatus(p: Proposal, filter: string) {
  if (filter === "all") return true;
  if (filter === "open") return isOpenProposal(p.status);
  if (filter === "closed") return isClosedProposal(p.status);
  return p.status === filter;
}

/**
 * The proposals list: what's in the pipeline, what's closed, and where each
 * one lives — its client portal and system links, straight from the row.
 * Viewers see all of it; the create and access buttons only render for those
 * who can use them (and the database refuses anyone else regardless).
 */
export function ProposalsView({
  proposals,
  links,
  ready,
  canManage,
  isSuperAdmin,
  grantable,
}: {
  proposals: Proposal[];
  /** Client-portal and system links per proposal, from their link notes. */
  links: Record<string, ProposalLinks>;
  /** False until the proposals migrations have been run. */
  ready: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
  /** Who the super admin could give access to. */
  grantable: PersonRef[];
}) {
  // Everything first: the page is opened to look something up as often as to
  // check the pipeline, and "Open" hid every closed proposal by default.
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  // Headline numbers over every proposal, not the filtered view — they describe
  // the pipeline, not whatever happens to be on screen.
  const stats = useMemo(() => {
    const open = proposals.filter((p) => isOpenProposal(p.status));
    const won = proposals.filter((p) => p.status === "Won");
    const lost = proposals.filter((p) => p.status === "Lost");
    // With the client and waiting on them: the ones worth chasing.
    const awaiting = proposals.filter((p) => p.status === "Sent" || p.status === "Negotiating");
    const sum = (list: Proposal[]) => list.reduce((total, p) => total + (p.value || 0), 0);
    return {
      openCount: open.length,
      openValue: sum(open),
      wonCount: won.length,
      wonValue: sum(won),
      winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      closed: won.length + lost.length,
      awaitingCount: awaiting.length,
      awaitingValue: sum(awaiting),
    };
  }, [proposals]);

  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (p: Proposal) =>
      !q ||
      `${p.title} ${p.clientName || ""} ${p.contacts.map((c) => `${c.name} ${c.email || ""}`).join(" ")}`
        .toLowerCase()
        .includes(q);
  }, [search]);

  const counts = useMemo(() => {
    const base = proposals.filter(matchesSearch);
    const result: Record<string, number> = {};
    for (const pill of PILLS) result[pill.value] = base.filter((p) => matchesStatus(p, pill.value)).length;
    return result;
  }, [proposals, matchesSearch]);

  const filtered = useMemo(
    () => proposals.filter((p) => matchesSearch(p) && matchesStatus(p, status)),
    [proposals, matchesSearch, status]
  );

  const { sorted, sort, toggle } = useSort<Proposal, SortKey>(filtered, {
    title: (p) => p.title,
    status: (p) => STATUS_RANK.get(p.status) ?? 99,
    value: (p) => p.value,
    // Unset sorts last (null), rather than reading as the shortest build.
    build: (p) => (p.buildPhases.length ? totalWeeks(p.buildPhases) : null),
    updated: (p) => p.updatedAt,
  });
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, paged } = usePagination(sorted);

  if (!ready) {
    return (
      <EmptyState
        icon={Handshake}
        title="Proposals need a one-time database update"
        description="Run migrations 045, 046 and 047 (in supabase/migrations/) in the Supabase SQL Editor, then reload this page."
      />
    );
  }

  const TILES = [
    {
      label: "Open pipeline",
      value: formatMoney(stats.openValue),
      sub: `${stats.openCount} open ${stats.openCount === 1 ? "proposal" : "proposals"}`,
      icon: CircleDollarSign,
    },
    {
      label: "Closed – Won",
      value: formatMoney(stats.wonValue),
      sub: `${stats.wonCount} won`,
      icon: Trophy,
    },
    {
      label: "Win rate",
      value: stats.winRate === null ? "—" : `${stats.winRate}%`,
      sub: stats.closed ? `of ${stats.closed} closed` : "Nothing closed yet",
      icon: Handshake,
    },
    {
      label: "Awaiting reply",
      value: String(stats.awaitingCount),
      sub: stats.awaitingCount ? `${formatMoney(stats.awaitingValue)} sent or in negotiation` : "Nothing out with clients",
      icon: Send,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-togo-white">Proposals</h2>
          <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
            {proposals.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button size="sm" variant="secondary" onClick={() => setAccessOpen(true)}>
              <ShieldCheck size={14} /> Manage access
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New proposal
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="rounded-md border border-togo-border bg-togo-surface p-4">
              <div className="flex items-center justify-between text-xs text-togo-muted">
                {t.label}
                <Icon size={15} className="text-togo-faint" />
              </div>
              <p className="tnum mt-1.5 text-xl font-bold text-togo-white">{t.value}</p>
              <p className="mt-0.5 text-xs text-togo-faint">{t.sub}</p>
            </div>
          );
        })}
      </div>

      <FilterPills
        pills={PILLS}
        value={status}
        onChange={setStatus}
        counts={counts}
        toneFor={proposalTone}
        label="Filter proposals by status"
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search title, client or contacts..." />

      {proposals.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No proposals yet"
          description="Track every proposal from first draft to closed — with its documents, price, build timeline and links in one place."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> New proposal
              </Button>
            ) : undefined
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No proposals match"
          description={search.trim() ? "Try a different search." : "Nothing has that status right now."}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-togo-surface">
                <tr className="border-b border-togo-border text-left">
                  <SortableHeader label="Proposal" active={sort.key === "title"} direction={sort.direction} onClick={() => toggle("title")} />
                  <th scope="col" className="section-label w-48 whitespace-nowrap px-4 py-2.5">
                    Client portal
                  </th>
                  <th scope="col" className="section-label w-48 whitespace-nowrap px-4 py-2.5">
                    System links
                  </th>
                  <SortableHeader label="Status" active={sort.key === "status"} direction={sort.direction} onClick={() => toggle("status")} className="w-36" />
                  <SortableHeader label="Value" active={sort.key === "value"} direction={sort.direction} onClick={() => toggle("value")} className="w-28" />
                  <SortableHeader label="Build" active={sort.key === "build"} direction={sort.direction} onClick={() => toggle("build")} className="w-28" />
                  <SortableHeader label="Updated" active={sort.key === "updated"} direction={sort.direction} onClick={() => toggle("updated")} className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-togo-border">
                {paged.map((p) => {
                  const href = `/proposals/${p.id}`;
                  return (
                    <tr key={p.id} className="align-top transition-colors hover:bg-[var(--togo-hover)]">
                      <td className="px-4 py-3">
                        <IntentLink href={href} className="group block min-w-0">
                          <span className="block truncate font-semibold text-togo-white transition-colors group-hover:text-togo-blue">
                            {p.title}
                          </span>
                          <span className="flex items-center gap-2 truncate text-xs text-togo-faint">
                            {p.clientName || "No client set"}
                            {p.documentCount > 0 && (
                              <span className="inline-flex items-center gap-0.5" title={`${p.documentCount} documents`}>
                                <FileText size={11} /> {p.documentCount}
                              </span>
                            )}
                          </span>
                        </IntentLink>
                      </td>
                      <td className="px-4 py-3">
                        <LinkListCell hrefs={links[p.id]?.portal} kind="portal" moreHref={href} />
                      </td>
                      <td className="px-4 py-3">
                        <LinkListCell hrefs={links[p.id]?.system} kind="system" moreHref={href} />
                      </td>
                      <td className="px-4 py-3">
                        <ProposalStatusBadge status={p.status} />
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-3 font-semibold text-togo-white">
                        {formatMoney(p.value, p.currency)}
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-3 text-xs text-togo-muted">
                        {p.buildPhases.length ? formatWeeks(totalWeeks(p.buildPhases)) : <span className="text-togo-faint">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-togo-faint" title={p.updatedAt}>
                        {timeAgo(p.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t border-togo-border px-4 py-3"
          />
        </div>
      )}

      {/* Mounted only while open, so each opening starts from a blank form. */}
      {createOpen && <ProposalFormModal open onClose={() => setCreateOpen(false)} />}
      {isSuperAdmin && <ProposalAccessModal open={accessOpen} onClose={() => setAccessOpen(false)} people={grantable} />}
    </div>
  );
}
