"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, FolderPlus, Plus, Trash2, X, GripVertical, SearchX, UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewToggle } from "@/components/ui/ViewToggle";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MemberProjectModal } from "@/components/members/MemberProjectModal";
import { FeaturedClients } from "@/components/members/FeaturedClients";
import { ClientModal } from "@/components/members/ClientModal";
import { can } from "@/lib/capabilities";
import { AddMemberModal } from "@/components/members/AddMemberModal";
import { useToast } from "@/components/ui/Toast";
import { Pagination } from "@/components/ui/Pagination";
import { ColumnsMenu } from "@/components/ui/ColumnsMenu";
import { TierBadge } from "@/components/ui/TierBadge";
import { cn } from "@/lib/utils";
import { usePagination } from "@/lib/usePagination";
import { useDragReorder } from "@/lib/useDragReorder";
import { useHotkeys } from "@/lib/useHotkeys";
import { useViewMode } from "@/lib/useViewMode";
import { useSort } from "@/lib/useSort";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useColumns } from "@/lib/useColumns";
import { TEN_ROWS_PY25 } from "@/lib/tableHeights";
import type { MemberItem, ClientItem, AccessLevel } from "@/types";

interface MemberRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  access_level: AccessLevel;
  /** Invited but hasn't signed in yet. */
  pending?: boolean;
  /** Counted in Postgres rather than shipped row-by-row — see migration 042. */
  stats: { total: number; completed: number; projects: string[] };
}

type MemberSortKey = "name" | "role" | "access" | "projectCount";

// Sorting by access should run most-privileged first, not alphabetically —
// "admin" < "super_admin" < "user" as strings is meaningless to a reader.
const ACCESS_RANK: Record<string, number> = { super_admin: 0, admin: 1, user: 2 };

export function MembersView({ members }: { members: MemberRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const { view, setView, toggleView } = useViewMode("members-view");
  const { currentUser } = useCurrentUser();
  const canAddMember = can(currentUser?.capabilities, "team.member.add");
  const canAddClient = can(currentUser?.capabilities, "team.client.add");
  const [scope, setScope] = useState<"active" | "pending">("active");
  const canAssignProject = can(currentUser?.capabilities, "project.assign");
  const [fullMembers, setFullMembers] = useState<MemberItem[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [visibleMembers, setVisibleMembers] = useState(members);
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientItem | null>(null);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { visible: columnVisibility, isVisible, toggle: toggleColumn } = useColumns("members");

  // "Name" is the row's identity, so it isn't offered as hideable.
  const MEMBER_COLUMNS = [
    { key: "role", label: "Role" },
    { key: "access", label: "Access" },
    { key: "projects", label: "Projects" },
    { key: "projectCount", label: "Project Count" },
  ];

  useHotkeys({
    "/": () => searchRef.current?.focus(),
    v: () => toggleView(),
  });

  // Tab counts ignore the search box — they say how many people are in each
  // state, not how many survive the current query.
  const scopeCounts = useMemo(
    () => ({
      active: visibleMembers.filter((m) => !m.pending).length,
      pending: visibleMembers.filter((m) => m.pending).length,
    }),
    [visibleMembers]
  );

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inScope = visibleMembers.filter((m) => (scope === "pending" ? !!m.pending : !m.pending));
    if (!q) return inScope;
    return inScope.filter((m) => `${m.name} ${m.role}`.toLowerCase().includes(q));
  }, [visibleMembers, search, scope]);

  const { ordered: orderedMembers, dragHandleProps, dropTargetProps, draggedId } = useDragReorder(
    filteredMembers,
    (m) => m.id,
    `members-order:${currentUser?.id ?? "anon"}`
  );

  const projectCount = (m: MemberRow) => m.stats.projects.length;

  // Sorted ahead of pagination so a column sort covers every member, not just
  // whichever ones happen to be on the current page.
  const { sorted: sortedMembers, sort, toggle } = useSort<MemberRow, MemberSortKey>(orderedMembers, {
    name: (m) => m.name,
    role: (m) => m.role,
    access: (m) => ACCESS_RANK[m.access_level] ?? 99,
    projectCount,
  });

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    paged: pagedMembers,
  } = usePagination(sortedMembers);

  // Re-sorting changes what "the top" means, so jump back to the first page.
  function handleToggleSort(key: MemberSortKey) {
    toggle(key);
    setPage(1);
  }

  // Manual drag order is only meaningful while no column sort is applied.
  const reorderable = sort.key === null;

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((data) => setFullMembers(data.members || []));
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjectNames(data.projects || []));
    loadClients();
  }, []);

  function loadClients() {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients || []));
  }

  function openAddClient() {
    setEditingClient(null);
    setClientModalOpen(true);
  }

  function openEditClient(client: ClientItem) {
    setEditingClient(client);
    setClientModalOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/members/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`${deleteTarget.name}'s account was deleted.`);
      setVisibleMembers((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setDeleteTarget(null);
    } else {
      const data = await res.json();
      setDeleteError(data.error || "Failed to delete member.");
    }
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      <FeaturedClients
        clients={clients}
        canManage={!!currentUser?.isSuperAdmin}
        onEdit={openEditClient}
        action={
          canAssignProject ? (
            /* size="sm" to match "New user" on Access Levels — the two are the
               same kind of top-of-page action and were different heights. */
            <Button size="sm" onClick={() => setAssignModalOpen(true)}>
              <FolderPlus size={14} /> Assign Project
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* Someone invited who hasn't signed in yet is easy to lose in a long
            list — the tab makes "who still needs chasing" a click. */}
        <SegmentedTabs
          label="Member status"
          value={scope}
          onChange={(v) => {
            setScope(v as "active" | "pending");
            setPage(1);
          }}
          tabs={[
            { label: "Active", value: "active", count: scopeCounts.active },
            { label: "Pending", value: "pending", count: scopeCounts.pending },
          ]}
        />
        <SearchInput
          ref={searchRef}
          value={search}
          onChange={setSearch}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          }}
          placeholder="Search by name or role..."
        />
        {search.trim() && (
          <button
            onClick={() => setSearch("")}
            className="flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
          >
            <X size={14} /> Clear search
          </button>
        )}

        {/* Both account-creation buttons share the search row rather than
            sitting in rows of their own, so they line up with the right-hand
            controls on the other list pages.

            A client can bring in another client — a stakeholder introducing a
            colleague to watch alongside them — but not a team member, which
            would be staffing the team. */}
        {(canAddClient || canAddMember) && (
          <div className="ml-auto flex items-center gap-2">
            {canAddClient && (
              <Button size="sm" variant="secondary" onClick={openAddClient}>
                <Plus size={14} /> Add Client
              </Button>
            )}
            {canAddMember && (
              <Button size="sm" variant="secondary" onClick={() => setAddMemberModalOpen(true)}>
                <UserPlus size={14} /> Add member
              </Button>
            )}
          </div>
        )}
      </div>

      {filteredMembers.length === 0 ? (
        search.trim() ? (
          <EmptyState
            icon={SearchX}
            title="No members match that search"
            description={`Nothing matches “${search.trim()}”. Try part of a first name or a job title.`}
            action={
              <Button size="sm" variant="secondary" onClick={() => setSearch("")}>
                Clear search
              </Button>
            }
          />
        ) : scope === "pending" ? (
          /* An empty Pending tab is the good outcome, so it doesn't get the
             "add someone" call to action the empty Active tab does. */
          <EmptyState
            icon={Clock}
            title="Nobody pending"
            description="Everyone with an account has signed in at least once. New accounts appear here until their first sign-in."
            action={
              <Button size="sm" variant="secondary" onClick={() => setScope("active")}>
                View active members
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No team members yet"
            description="Add the people on your tech team so their updates, projects and tracked time show up here."
            action={
              canAddMember ? (
                <Button size="sm" onClick={() => setAddMemberModalOpen(true)}>
                  <UserPlus size={14} /> Add member
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        /* One panel owns the results: counts and table controls in the header,
           rows in the middle, paging in the footer — the controls stay attached
           to what they act on. */
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-togo-border px-4 py-3">
            <span className="tnum text-xs text-togo-faint">
              <span className="font-semibold text-togo-muted">{filteredMembers.length}</span>
              {filteredMembers.length === 1 ? " member" : " members"}
              {filteredMembers.length !== visibleMembers.length && ` of ${visibleMembers.length}`}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <ViewToggle value={view} onChange={setView} className="shrink-0" />
              {view === "table" && (
                <ColumnsMenu columns={MEMBER_COLUMNS} visible={columnVisibility} onToggle={toggleColumn} />
              )}
            </div>
          </div>

          {view === "card" ? (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {pagedMembers.map((m) => {
            const done = m.stats.completed;
            const canDelete = can(currentUser?.capabilities, "member.delete") && currentUser?.id !== m.id;
            return (
              <Link
                key={m.id}
                href={`/members/${m.id}`}
                className="card-hover relative rounded-md border border-togo-border bg-togo-surface p-4 text-center hover:border-togo-blue"
              >
                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(m);
                    }}
                    title={`Delete ${m.name}`}
                    aria-label={`Delete ${m.name}`}
                    className="absolute right-2 top-2 rounded p-0.5 text-[var(--status-blocked-fg)] transition-colors hover:bg-[var(--status-blocked-bg)]"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <div className="mb-2.5 flex justify-center">
                  <Avatar
                    name={m.name}
                    avatarUrl={m.avatar_url}
                    size="md"
                    className={cn("!h-12 !w-12 !text-base", m.pending && "opacity-50")}
                  />
                </div>
                <div className="truncate text-sm font-bold text-togo-white">{m.name}</div>
                <div className="mb-2 truncate text-[11px] text-togo-muted">{m.role}</div>
                {m.pending && (
                  <div className="mb-2 flex justify-center">
                    <span
                      title="Invited — hasn't signed in yet"
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--status-hold-border)] bg-[var(--status-hold-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-hold-fg)]"
                    >
                      <Clock size={9} /> Pending
                    </span>
                  </div>
                )}
                <div className="flex justify-center mb-3">
                  <TierBadge tier={m.access_level} />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded bg-togo-surface-2 p-1.5" title={`${m.stats.total} updates logged`}>
                    <div className="text-[10px] text-togo-faint">Updates</div>
                    <div className="tnum text-base font-bold text-togo-white">{m.stats.total}</div>
                  </div>
                  <div className="rounded bg-togo-surface-2 p-1.5" title={`${done} marked completed`}>
                    <div className="text-[10px] text-togo-faint">Done</div>
                    <div className="tnum text-base font-bold text-[var(--status-completed-fg)]">{done}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
          ) : (
            <div className={`overflow-x-auto ${TEN_ROWS_PY25}`}>
          <table className="w-full min-w-[600px] text-sm">
            <thead className="sticky top-0 z-10 bg-togo-surface">
              <tr className="border-b border-togo-border text-left">
                <th scope="col" className="w-8 px-2 py-3">
                  <span className="sr-only">Reorder</span>
                </th>
                {(
                  [
                    { key: "name", label: "Name" },
                    { key: "role", label: "Role" },
                    { key: "access", label: "Access" },
                  ] as const
                )
                  .filter((c) => c.key === "name" || isVisible(c.key))
                  .map((c) => (
                    <SortableHeader
                      key={c.key}
                      label={c.label}
                      active={sort.key === c.key}
                      direction={sort.direction}
                      onClick={() => handleToggleSort(c.key)}
                    />
                  ))}
                {isVisible("projects") && (
                  <th scope="col" className="section-label whitespace-nowrap px-4 py-2.5">
                    Projects
                  </th>
                )}
                {isVisible("projectCount") && (
                  <SortableHeader
                    label="Project Count"
                    active={sort.key === "projectCount"}
                    direction={sort.direction}
                    onClick={() => handleToggleSort("projectCount")}
                  />
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-togo-border">
              {pagedMembers.map((m) => {
                const uniqueProjects = m.stats.projects;
                return (
                  <tr
                    key={m.id}
                    {...(reorderable ? dropTargetProps(m.id) : {})}
                    className={cn(
                      "transition-colors hover:bg-[var(--togo-hover)]",
                      draggedId === m.id && "opacity-40"
                    )}
                  >
                    <td className="px-2 py-3">
                      {reorderable ? (
                        <span
                          {...dragHandleProps(m.id)}
                          title="Drag to reorder"
                          className="inline-flex cursor-grab text-togo-faint transition-colors hover:text-togo-muted active:cursor-grabbing"
                        >
                          <GripVertical size={14} />
                        </span>
                      ) : (
                        <span
                          title="Clear the column sort to reorder rows manually"
                          className="inline-flex text-togo-border"
                        >
                          <GripVertical size={14} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/members/${m.id}`} className="flex items-center gap-2 whitespace-nowrap">
                        <Avatar
                          name={m.name}
                          avatarUrl={m.avatar_url}
                          size="sm"
                          className={cn(m.pending && "opacity-50")}
                        />
                        <span className="font-semibold text-togo-white">{m.name}</span>
                        {m.pending && (
                          <span
                            title="Invited — hasn't signed in yet"
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--status-hold-border)] bg-[var(--status-hold-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-hold-fg)]"
                          >
                            <Clock size={9} /> Pending
                          </span>
                        )}
                      </Link>
                    </td>
                    {isVisible("role") && (
                      <td className="px-4 py-2.5 text-togo-blue font-semibold uppercase text-xs tracking-wide whitespace-nowrap">
                        {m.role}
                      </td>
                    )}
                    {isVisible("access") && (
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <TierBadge tier={m.access_level} />
                      </td>
                    )}
                    {isVisible("projects") && (
                      <td className="px-4 py-2.5">
                      {uniqueProjects.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {uniqueProjects.map((p) => (
                            <span
                              key={p}
                              className="text-xs px-2.5 py-1 rounded-full bg-togo-charcoal border border-togo-border text-togo-muted whitespace-nowrap"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-togo-faint">—</span>
                      )}
                    </td>
                    )}
                    {isVisible("projectCount") && (
                      <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-togo-blue-muted text-togo-blue">
                        {uniqueProjects.length} {uniqueProjects.length === 1 ? "project" : "projects"}
                      </span>
                    </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
            </div>
          )}

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

      {canAssignProject && (
        <MemberProjectModal
          open={assignModalOpen}
          onClose={() => setAssignModalOpen(false)}
          onSaved={() => setAssignModalOpen(false)}
          members={fullMembers}
          editingProject={null}
          existingProjects={projectNames}
        />
      )}

      {/* Must match the Add Client button's own gate — a modal that never
          mounts just looks like a dead button. */}
      {canAddClient && (
        <ClientModal
          open={clientModalOpen}
          onClose={() => setClientModalOpen(false)}
          onSaved={loadClients}
          onDeleted={loadClients}
          editingClient={editingClient}
        />
      )}

      {canAddMember && (
        <AddMemberModal
          open={addMemberModalOpen}
          onClose={() => setAddMemberModalOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Member"
        description={`Are you sure you want to permanently delete ${deleteTarget?.name}'s account? This removes their profile and all their updates, time entries, and projects. This can't be undone.${
          deleteError ? ` ${deleteError}` : ""
        }`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
