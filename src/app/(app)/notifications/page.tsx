"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/ui/IntentLink";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CheckSquare,
  Inbox,
  Minus,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn, formatDateShort, timeAgo } from "@/lib/utils";
import { notificationVisual } from "@/lib/notificationDisplay";
import {
  fetchNotifications,
  markAllSeen,
  setUnreadCount,
  type NotificationFilter,
  type NotificationItem,
} from "@/lib/useUnreadNotifications";

const TABS: { key: NotificationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "archived", label: "Archived" },
];

// The tabs cover read state, so the only other axis worth filtering on is what
// actually happened. Applied client-side — the list is already capped at 50.
type TypeFilter = "all" | "project_assigned" | "project_removed" | "project_created";

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All activity" },
  { key: "project_assigned", label: "Added to a project" },
  { key: "project_removed", label: "Removed from a project" },
  { key: "project_created", label: "New projects" },
];

/**
 * Tri-state checkbox. A real <input type="checkbox"> can only be made
 * indeterminate imperatively via a ref, and it can't be themed to match the
 * rest of the hub, so this is a button carrying the checkbox role.
 */
function SelectBox({
  checked,
  indeterminate = false,
  onToggle,
  label,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-50",
        on
          ? "border-togo-blue bg-togo-blue text-white"
          : "border-togo-border-strong bg-togo-surface-2 text-transparent hover:border-togo-blue"
      )}
    >
      {indeterminate ? <Minus size={11} /> : checked ? <Check size={11} /> : null}
    </button>
  );
}

export default function NotificationsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Close the filter menu on outside click and Escape.
  useEffect(() => {
    if (!filterOpen) return;
    function onClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const load = useCallback(async (filter: NotificationFilter) => {
    const data = await fetchNotifications(filter);
    setItems(data.notifications);
    setUnread(data.unreadCount);
    setArchivedCount(data.archivedCount);
    // Drop any selected id that's no longer in the list — deleted, or archived
    // out of this tab. Without this a stale selection could act on rows that
    // aren't on screen, and the "N selected" count would disagree with the
    // ticked boxes.
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(data.notifications.map((n) => n.id));
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    load(tab);
  }, [tab, load]);

  // Narrowing the type filter or the search hides rows, and acting on a hidden
  // row is never what the button in front of you appears to promise.
  useEffect(() => {
    setSelected(new Set());
  }, [typeFilter, query]);

  // Being on this page counts as having looked, however you got here — a
  // bookmark, a refresh, or a link from a notification. Runs once on mount
  // rather than per tab, so switching tabs doesn't re-post.
  useEffect(() => {
    markAllSeen();
  }, []);

  async function markAllRead() {
    setMarking(true);
    const stamp = new Date().toISOString();
    // Optimistic, and the shared count is published so the sidebar badge and
    // topbar bell clear at the same moment rather than on next navigation.
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? stamp })));
    setUnread(0);
    setUnreadCount(0);

    const res = await fetch("/api/notifications", { method: "PATCH" });
    if (!res.ok) {
      toast.error("Couldn't mark those as read. Please try again.");
      await load(tab);
    }
    setMarking(false);
  }

  async function act(n: NotificationItem, body: { read?: boolean; archived?: boolean }) {
    setBusyId(n.id);
    const res = await fetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) toast.error("That didn't work. Please try again.");
    // Reloading rather than patching in place: archiving moves a row between
    // tabs, and the counts have to come from the server anyway.
    await load(tab);
    setBusyId(null);
  }

  /**
   * Opening a notification is what marks that one read — the badge is already
   * gone by this point (that's "seen"), but each item stays unread until it's
   * actually been looked at. Optimistic, and fire-and-forget because we're
   * navigating away: client-side routing keeps the JS context alive, so the
   * request still completes.
   */
  function markOneRead(n: NotificationItem) {
    if (n.readAt) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
    fetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => {});
  }

  async function remove(n: NotificationItem) {
    setBusyId(n.id);
    const res = await fetch(`/api/notifications/${n.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Notification deleted.");
    else toast.error("Couldn't delete that. Please try again.");
    await load(tab);
    setBusyId(null);
  }

  const now = new Date();
  const term = query.trim().toLowerCase();

  // Both filters are client-side, which is honest here: the list the server
  // returns is capped at 50, so there's nothing off-screen for a query to miss.
  const visible = items.filter((n) => {
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (!term) return true;
    // The project, who did it, and the role you were given — the three strings
    // a person actually remembers a notification by.
    return [n.project, n.actorName, n.role].some((field) => field?.toLowerCase().includes(term));
  });
  const filteredOut = items.length - visible.length;

  // Selection is scoped to what's on screen, so "select all" never reaches past
  // the current tab, type filter and search.
  const selectedCount = selected.size;
  const allVisibleSelected = visible.length > 0 && visible.every((n) => selected.has(n.id));
  const someVisibleSelected = selectedCount > 0 && !allVisibleSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => (prev.size > 0 ? new Set() : new Set(visible.map((n) => n.id))));
  }

  async function bulkAct(body: { read?: boolean; archived?: boolean }, describe: (n: number) => string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setBulkBusy(true);
    const res = await fetch("/api/notifications/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, ...body }),
    });

    if (res.ok) {
      setSelected(new Set());
      toast.success(describe(ids.length));
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "That didn't work. Please try again.");
    }
    // Reloading rather than patching in place: these actions move rows between
    // tabs, and the counts have to come from the server anyway.
    await load(tab);
    setBulkBusy(false);
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setBulkBusy(true);
    const res = await fetch("/api/notifications/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    if (res.ok) {
      setSelected(new Set());
      toast.success(`${ids.length} ${ids.length === 1 ? "notification" : "notifications"} deleted.`);
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't delete those. Please try again.");
    }
    setConfirmDeleteOpen(false);
    await load(tab);
    setBulkBusy(false);
  }

  return (
    <div className="space-y-4">
      {/* Controls share the tab row: they act on what the tabs are showing, and
          a separate row above them left a band of empty space where the page
          title used to be. */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-togo-border">
        <div role="tablist" aria-label="Filter notifications" className="flex gap-1">
          {TABS.map((t) => {
            const count = t.key === "unread" ? unread : t.key === "archived" ? archivedCount : 0;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active ? "border-togo-blue text-togo-white" : "border-transparent text-togo-muted hover:text-togo-white"
                )}
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "tnum rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                      t.key === "unread"
                        ? "bg-[var(--status-blocked-fg)] text-white"
                        : "bg-togo-surface-2 text-togo-muted"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* mb-1.5 so the buttons sit clear of the tabs' underline rather than
            colliding with it. */}
        <div className="mb-1.5 flex items-center gap-2">
          {/* Always present rather than appearing only when something's unread —
              a control that comes and goes is harder to find than one that's
              simply disabled. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={markAllRead}
            disabled={marking || unread === 0}
            title={unread === 0 ? "Nothing unread" : `Mark ${unread} as read`}
          >
            <CheckCheck size={14} /> {marking ? "Marking..." : "Mark all as read"}
          </Button>

          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              aria-label="Filter notifications"
              aria-expanded={filterOpen}
              title="Filter by type"
              className={cn(
                "rounded-md border p-2 transition-colors",
                typeFilter === "all"
                  ? "border-togo-border text-togo-muted hover:border-togo-blue hover:text-togo-blue"
                  : "border-togo-blue bg-togo-blue/10 text-togo-blue"
              )}
            >
              <SlidersHorizontal size={15} />
            </button>

            {filterOpen && (
              <div className="animate-fade-in absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-md border border-togo-border bg-togo-surface shadow-[var(--shadow-modal)]">
                <p className="border-b border-togo-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-togo-faint">
                  Type
                </p>
                {TYPE_FILTERS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => {
                      setTypeFilter(t.key);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--togo-hover)]",
                      typeFilter === t.key ? "text-togo-blue" : "text-togo-muted"
                    )}
                  >
                    <span className="flex w-3.5 justify-center">
                      {typeFilter === t.key && <Check size={12} />}
                    </span>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading notifications">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      ) : (
        <>
          {/* Rendered whenever the tab has any rows at all — not just when the
              filters match something. A search that hides everything would
              otherwise take its own input off screen, leaving no way to clear
              the query except reloading the page. */}
          {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-togo-border bg-togo-surface px-3 py-2">
            <SelectBox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onToggle={toggleAllVisible}
              disabled={bulkBusy || visible.length === 0}
              label={selectedCount > 0 ? "Clear selection" : `Select all ${visible.length}`}
            />

            {selectedCount > 0 ? (
              <span className="tnum text-xs font-semibold text-togo-white">
                {selectedCount} selected
              </span>
            ) : (
              <span className="text-xs text-togo-faint">
                Select notifications to act on several at once
              </span>
            )}

            {/* Actions and search share the right-hand side: the search box
                stays put as selection comes and goes, so it never jumps
                sideways under the cursor mid-type. */}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {selectedCount > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() =>
                      bulkAct({ read: true }, (n) => `${n} marked as read.`)
                    }
                  >
                    <CheckCheck size={13} /> Read
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() =>
                      bulkAct({ read: false }, (n) => `${n} marked as unread.`)
                    }
                  >
                    <Square size={13} /> Unread
                  </Button>
                  {/* The All and Unread tabs never contain archived rows (the
                      query excludes them), so the action is unambiguous per tab
                      rather than a per-row toggle. */}
                  {tab === "archived" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={bulkBusy}
                      onClick={() =>
                        bulkAct({ archived: false }, (n) => `${n} moved back to your inbox.`)
                      }
                    >
                      <ArchiveRestore size={13} /> Move to inbox
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={bulkBusy}
                      onClick={() => bulkAct({ archived: true }, (n) => `${n} archived.`)}
                    >
                      <Archive size={13} /> Archive
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
                  >
                    <Trash2 size={13} /> Delete
                  </Button>
                </>
              )}

              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-togo-faint"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                  }}
                  placeholder="Search project or person"
                  aria-label="Search notifications"
                  className="h-8 w-full py-1 pl-8 pr-7 text-xs sm:w-56"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    title="Clear search"
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-togo-faint transition-colors hover:text-togo-white"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
          )}

          {visible.length === 0 ? (
            // Three different reasons the list can be empty, each with a
            // different fix: a query that matched nothing, a type filter hiding
            // everything, or genuinely nothing in this tab.
            term ? (
              <EmptyState
                icon={Search}
                title="No matches"
                description={`Nothing in ${
                  tab === "archived" ? "your archive" : tab === "unread" ? "your unread" : "this list"
                } matches “${query.trim()}”.`}
                action={
                  <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            ) : filteredOut > 0 ? (
              <EmptyState
                icon={SlidersHorizontal}
                title="Nothing of that type here"
                description={`${filteredOut} ${
                  filteredOut === 1 ? "notification is" : "notifications are"
                } hidden by the type filter.`}
                action={
                  <Button size="sm" variant="secondary" onClick={() => setTypeFilter("all")}>
                    Show all activity
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={tab === "archived" ? Archive : tab === "unread" ? BellOff : Bell}
                title={
                  tab === "archived"
                    ? "Nothing archived"
                    : tab === "unread"
                    ? "You're all caught up"
                    : "No notifications yet"
                }
                description={
                  tab === "archived"
                    ? "Notifications you archive are kept here rather than deleted."
                    : tab === "unread"
                    ? "Every notification has been read."
                    : "New projects, and being added to or taken off one, all show up here."
                }
              />
            )
          ) : (
          <ul className="mt-2 overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          {visible.map((n) => {
            const { verb, icon: TypeIcon, badgeClass, systemGenerated } = notificationVisual(n.type);
            const isBusy = busyId === n.id;
            const isArchived = !!n.archivedAt;
            const isSelected = selected.has(n.id);
            return (
              <li
                key={n.id}
                className={cn(
                  "group flex items-center gap-2 border-b border-togo-border px-3 py-3 transition-colors last:border-b-0 hover:bg-[var(--togo-hover)]",
                  !n.readAt && "bg-[var(--status-blocked-fg)]/[0.04]",
                  // Selection wins over the unread tint so a ticked row reads as
                  // ticked regardless of its read state.
                  isSelected && "bg-togo-blue/[0.08]",
                  isBusy && "opacity-50"
                )}
              >
                {/* Outside the Link below, or ticking a box would navigate. */}
                <SelectBox
                  checked={isSelected}
                  onToggle={() => toggleOne(n.id)}
                  disabled={bulkBusy}
                  label={`Select this notification about ${n.project}`}
                />
                {/* The whole body is the click target — a single project name is
                    a small thing to hit. The action buttons sit outside this
                    link so they don't navigate. */}
                <IntentLink
                  href={`/projects/${encodeURIComponent(n.project)}`}
                  onClick={() => markOneRead(n)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {/* Unread marker keeps its own column so rows stay aligned
                      whether or not the dot is there. */}
                  <span className="flex w-2 shrink-0 justify-center">
                    {!n.readAt && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-togo-blue" />}
                  </span>

                  <span className="relative shrink-0">
                    <Avatar name={n.actorName || "?"} avatarUrl={n.actorAvatarUrl} size="sm" />
                    {/* Says at a glance what kind of event this was, without
                        having to read the sentence. */}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-togo-surface",
                        badgeClass
                      )}
                    >
                      <TypeIcon size={9} className="text-white" />
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-togo-white">
                      {systemGenerated ? (
                        <>
                          <span className="font-medium text-togo-blue">{n.project}</span>{" "}
                          <span className="text-togo-muted">{verb} — mark it complete or extend the timeline</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{n.actorName || "Someone"}</span> {verb}{" "}
                          <span className="font-medium text-togo-blue">{n.project}</span>
                          {n.role && n.type === "project_assigned" && (
                            <span className="text-togo-muted"> as {n.role}</span>
                          )}
                        </>
                      )}
                    </span>
                    <span className="tnum mt-0.5 block text-[11px] text-togo-faint">
                      {timeAgo(n.createdAt, now)} · {formatDateShort(n.createdAt)}
                    </span>
                  </span>
                </IntentLink>

                {/* Revealed on hover on a pointer device, but always present for
                    keyboard and touch — hiding them outright would strand them. */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => act(n, { read: !n.readAt })}
                    disabled={isBusy}
                    title={n.readAt ? "Mark as unread" : "Mark as read"}
                    aria-label={n.readAt ? "Mark as unread" : "Mark as read"}
                    className="rounded p-1.5 text-togo-faint transition-colors hover:bg-togo-surface-2 hover:text-togo-blue disabled:opacity-50"
                  >
                    {n.readAt ? <Square size={15} /> : <CheckSquare size={15} />}
                  </button>
                  <button
                    onClick={() => act(n, { archived: !isArchived })}
                    disabled={isBusy}
                    title={isArchived ? "Move back to inbox" : "Archive"}
                    aria-label={isArchived ? "Move back to inbox" : "Archive"}
                    className="rounded p-1.5 text-togo-faint transition-colors hover:bg-togo-surface-2 hover:text-togo-blue disabled:opacity-50"
                  >
                    {isArchived ? <ArchiveRestore size={15} /> : <Inbox size={15} />}
                  </button>
                  <button
                    onClick={() => remove(n)}
                    disabled={isBusy}
                    title="Delete"
                    aria-label="Delete"
                    className="rounded p-1.5 text-[var(--status-blocked-fg)] transition-colors hover:bg-[var(--status-blocked-bg)] disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            );
          })}
          </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete ${selectedCount} ${selectedCount === 1 ? "notification" : "notifications"}`}
        description={`This permanently removes ${
          selectedCount === 1 ? "it" : "them"
        } — deleting isn't the same as archiving, and there's no undo. Archive instead if you just want them out of your inbox.`}
        confirmLabel={`Delete ${selectedCount}`}
        danger
        loading={bulkBusy}
        onConfirm={bulkDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
