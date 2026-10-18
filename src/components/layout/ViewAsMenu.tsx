"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { VIEW_AS_LABELS, VIEW_AS_LEVELS, type ViewAsLevel } from "@/lib/viewAs";
import { cn } from "@/lib/utils";

const DESCRIPTIONS: Record<ViewAsLevel, string> = {
  admin: "Runs the team and its projects",
  user: "A team member, seeing their own work",
  client: "A read-only observer",
};

/**
 * Starts or ends a preview, then reloads. A full reload rather than
 * router.refresh(): who you are is cached in several places in the browser
 * (useCurrentUser, the JSON cache, Next's page cache), and all of them have to
 * forget the old tier together.
 */
async function switchViewAs(level: ViewAsLevel | null): Promise<string | null> {
  const res = await fetch(
    "/api/view-as",
    level
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level }) }
      : { method: "DELETE" }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return data.error || "Couldn't switch the preview.";
  }
  window.location.reload();
  return null;
}

/** "View as" — the super admin's switch for previewing the app as another access level. */
export function ViewAsMenu({ viewingAs }: { viewingAs: ViewAsLevel | null }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ViewAsLevel | "self" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(level: ViewAsLevel | null) {
    if (level === viewingAs) {
      setOpen(false);
      return;
    }
    setBusy(level ?? "self");
    const error = await switchViewAs(level);
    // On success the page reloads, so only a failure gets here.
    if (error) {
      setBusy(null);
      toast.error(error);
    }
  }

  const options: { level: ViewAsLevel | null; label: string; description: string }[] = [
    { level: null, label: "Super admin", description: "You — everything, with changes allowed" },
    ...VIEW_AS_LEVELS.map((level) => ({ level, label: VIEW_AS_LABELS[level], description: DESCRIPTIONS[level] })),
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Preview the app as another access level"
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
          viewingAs
            ? "border-[var(--status-hold-border)] bg-[var(--status-hold-bg)] text-[var(--status-hold-fg)]"
            : "border-togo-border bg-togo-surface text-togo-muted hover:border-togo-blue hover:text-togo-blue"
        )}
      >
        <Eye size={15} />
        <span className="hidden sm:inline">{viewingAs ? `Viewing as ${VIEW_AS_LABELS[viewingAs]}` : "View as"}</span>
        <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="View as"
          className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-md border border-togo-border bg-togo-surface shadow-[var(--shadow-modal)]"
        >
          <p className="border-b border-togo-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-togo-faint">
            View the app as
          </p>
          {options.map((o) => {
            const current = o.level === viewingAs;
            const loading = busy === (o.level ?? "self");
            return (
              <button
                key={o.label}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                disabled={busy !== null}
                onClick={() => choose(o.level)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--togo-hover)] disabled:cursor-wait",
                  current && "bg-togo-blue/[0.06]"
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-togo-blue">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : current ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold", current ? "text-togo-blue" : "text-togo-white")}>
                    {o.label}
                  </span>
                  <span className="block text-xs text-togo-faint">{o.description}</span>
                </span>
              </button>
            );
          })}
          <p className="border-t border-togo-border px-3 py-2 text-[11px] leading-snug text-togo-faint">
            Previews are read-only: nothing you click saves until you switch back.
          </p>
        </div>
      )}
    </div>
  );
}

/** The strip across the top while a preview is on, so it can't be mistaken for the real thing. */
export function ViewAsBanner({ viewingAs }: { viewingAs: ViewAsLevel }) {
  const toast = useToast();
  const [exiting, setExiting] = useState(false);
  const label = VIEW_AS_LABELS[viewingAs];
  const article = viewingAs === "admin" ? "an" : "a";

  async function exit() {
    setExiting(true);
    const error = await switchViewAs(null);
    if (error) {
      setExiting(false);
      toast.error(error);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--status-hold-border)] bg-[var(--status-hold-bg)] px-4 py-2 text-xs text-[var(--status-hold-fg)] sm:px-6 md:px-8"
    >
      <Eye size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-bold">Previewing as {label}.</span> You&apos;re seeing what {article} {label.toLowerCase()}{" "}
        sees, and changes are turned off.
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="inline-flex items-center gap-1.5 rounded border border-current px-2 py-0.5 font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
      >
        {exiting && <Loader2 size={12} className="animate-spin" />}
        Exit preview
      </button>
    </div>
  );
}
