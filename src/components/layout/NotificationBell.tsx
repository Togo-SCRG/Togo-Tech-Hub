"use client";

import { useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/ui/IntentLink";
import { ArrowRight, Bell } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { cn, timeAgo } from "@/lib/utils";
import { notificationVisual } from "@/lib/notificationDisplay";
import {
  fetchNotifications,
  markAllSeen,
  useUnreadNotifications,
  type NotificationItem,
} from "@/lib/useUnreadNotifications";

const PREVIEW_COUNT = 5;

/**
 * Quick-look dropdown in the topbar. Shares its unread count with the sidebar
 * nav badge through the module store, so marking things read in either place
 * updates both — the full list lives at /notifications.
 */
export function NotificationBell() {
  const unread = useUnreadNotifications();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and Escape, so the panel can't get stranded.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    // Opening silences the badge but marks nothing read — individual items stay
    // unread until acted on, so the Unread tab still means something.
    markAllSeen();
    const data = await fetchNotifications();
    setItems(data.notifications);
  }

  /** Opening one marks that one read; the badge is already cleared by "seen". */
  function markOneRead(n: NotificationItem) {
    if (n.readAt) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    fetch(`/api/notifications/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => {});
  }

  const now = new Date();
  const preview = items.slice(0, PREVIEW_COUNT);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        className="relative rounded-md border border-togo-border bg-togo-surface p-1.5 text-togo-muted transition-colors hover:border-togo-blue hover:text-togo-blue"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--status-blocked-fg)] px-1 text-[9px] font-bold text-white ring-2 ring-togo-charcoal">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-fade-in absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-togo-border bg-togo-surface shadow-[var(--shadow-modal)]">
          <div className="flex items-center justify-between border-b border-togo-border px-4 py-2.5">
            <span className="text-xs font-semibold text-togo-white">Notifications</span>
            <IntentLink
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-[11px] text-togo-faint transition-colors hover:text-togo-blue"
            >
              View all <ArrowRight size={11} />
            </IntentLink>
          </div>

          {preview.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-togo-muted">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-togo-border overflow-y-auto">
              {preview.map((n) => {
                const { verb, icon: TypeIcon, badgeClass, systemGenerated } = notificationVisual(n.type);
                return (
                  <li key={n.id}>
                    <IntentLink
                      href={`/projects/${encodeURIComponent(n.project)}`}
                      onClick={() => {
                        markOneRead(n);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex gap-2.5 px-4 py-2.5 transition-colors hover:bg-[var(--togo-hover)]",
                        !n.readAt && "bg-[var(--status-blocked-fg)]/[0.04]"
                      )}
                    >
                      <span className="relative mt-0.5 shrink-0">
                        <Avatar
                          name={n.actorName || "?"}
                          avatarUrl={n.actorAvatarUrl}
                          size="sm"
                          className="!h-7 !w-7 !text-[10px]"
                        />
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-togo-surface",
                            badgeClass
                          )}
                        >
                          <TypeIcon size={8} className="text-white" />
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-snug text-togo-white">
                          {systemGenerated ? (
                            <>
                              <span className="font-semibold">{n.project}</span>{" "}
                              <span className="text-togo-muted">{verb}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">{n.actorName || "Someone"}</span> {verb}{" "}
                              <span className="font-semibold">{n.project}</span>
                              {n.role && n.type === "project_assigned" && (
                                <span className="text-togo-muted"> as {n.role}</span>
                              )}
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 text-[10px] text-togo-faint">{timeAgo(n.createdAt, now)}</p>
                      </div>
                      {!n.readAt && (
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-blocked-fg)]" />
                      )}
                    </IntentLink>
                  </li>
                );
              })}
            </ul>
          )}

          {items.length > PREVIEW_COUNT && (
            <IntentLink
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-togo-border px-4 py-2.5 text-center text-[11px] text-togo-faint transition-colors hover:text-togo-blue"
            >
              {items.length - PREVIEW_COUNT} more
            </IntentLink>
          )}
        </div>
      )}
    </div>
  );
}
