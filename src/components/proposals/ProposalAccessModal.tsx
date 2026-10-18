"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import type { PersonRef, ProposalAccessEntry, ProposalRole } from "@/types";

const ROLE_HINT: Record<ProposalRole, string> = {
  viewer: "Can see every proposal and its documents",
  manager: "Can also create, edit, change status, upload and delete",
};

/**
 * The super admin's list of who can see Proposals. Nobody is on it by default:
 * the feature doesn't exist for anyone who isn't, not even in the nav.
 */
export function ProposalAccessModal({
  open,
  onClose,
  people,
}: {
  open: boolean;
  onClose: () => void;
  /** Everyone who could be granted access — every account but the super admin. */
  people: PersonRef[];
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<ProposalAccessEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState<ProposalRole>("viewer");

  useEffect(() => {
    if (!open) return;
    setEntries(null);
    setLoadError(null);
    fetch("/api/proposals/access")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) setEntries(data.entries || []);
        else setLoadError(data.error || "Couldn't load the access list.");
      })
      .catch(() => setLoadError("Couldn't load the access list."));
  }, [open]);

  const available = useMemo(
    () => people.filter((p) => !entries?.some((e) => e.userId === p.id)),
    [people, entries]
  );

  async function grant(userId: string, role: ProposalRole) {
    setBusy(userId);
    const res = await fetch("/api/proposals/access", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error || "Couldn't change access.");
      return false;
    }
    const person = people.find((p) => p.id === userId);
    setEntries((prev) => {
      const list = prev || [];
      return list.some((e) => e.userId === userId)
        ? list.map((e) => (e.userId === userId ? { ...e, role } : e))
        : [...list, { userId, role, name: person?.name || "Unknown", avatarUrl: person?.avatarUrl ?? null }];
    });
    return true;
  }

  async function revoke(entry: ProposalAccessEntry) {
    setBusy(entry.userId);
    const res = await fetch(`/api/proposals/access?userId=${encodeURIComponent(entry.userId)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error || "Couldn't remove access.");
      return;
    }
    setEntries((prev) => (prev || []).filter((e) => e.userId !== entry.userId));
    toast.success(`${entry.name} no longer has access to proposals.`);
  }

  async function add() {
    if (!addId) return;
    const name = people.find((p) => p.id === addId)?.name;
    if (await grant(addId, addRole)) {
      toast.success(`${name ?? "They"} can now ${addRole === "manager" ? "manage" : "view"} proposals.`);
      setAddId("");
      setAddRole("viewer");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Who can access proposals" className="max-w-2xl">
      <div className="space-y-5">
        <p className="flex items-start gap-2 text-sm text-togo-muted">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-togo-blue" />
          Only the people listed here — and you, as super admin — can see Proposals at all. Everyone else won&apos;t
          find it in the menu, and the database refuses them too.
        </p>

        {/* Add someone */}
        <div className="rounded-md border border-togo-border bg-togo-surface-2/30 p-3">
          <p className="mb-2 text-xs font-semibold text-togo-white">Give someone access</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Person" className="sm:flex-1">
              <option value="">Choose a person…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as ProposalRole)}
              aria-label="Access"
              className="sm:w-40"
            >
              <option value="viewer">Can view</option>
              <option value="manager">Can manage</option>
            </Select>
            <Button type="button" onClick={add} disabled={!addId || busy !== null} className="shrink-0">
              <UserPlus size={14} /> Add
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-togo-faint">{ROLE_HINT[addRole]}.</p>
        </div>

        {/* The list */}
        {loadError ? (
          <p className="text-sm text-[var(--status-blocked-fg)]">{loadError}</p>
        ) : entries === null ? (
          <p className="flex items-center gap-2 text-sm text-togo-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-togo-border px-4 py-6 text-center text-sm text-togo-faint">
            Nobody else has access yet.
          </p>
        ) : (
          <ul className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
            {entries.map((entry) => (
              <li key={entry.userId} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={entry.name} avatarUrl={entry.avatarUrl} size="sm" className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-togo-white">{entry.name}</p>
                  <p className="truncate text-xs text-togo-faint">{ROLE_HINT[entry.role]}</p>
                </div>
                <Select
                  value={entry.role}
                  onChange={(e) => grant(entry.userId, e.target.value as ProposalRole)}
                  disabled={busy === entry.userId}
                  aria-label={`${entry.name}'s access`}
                  className="h-8 w-32 py-1 text-xs"
                >
                  <option value="viewer">Can view</option>
                  <option value="manager">Can manage</option>
                </Select>
                <button
                  type="button"
                  onClick={() => revoke(entry)}
                  disabled={busy === entry.userId}
                  title="Remove access"
                  aria-label={`Remove ${entry.name}'s access`}
                  className="rounded p-1.5 text-togo-faint transition-colors hover:bg-[var(--status-blocked-bg)] hover:text-[var(--status-blocked-fg)] disabled:opacity-40"
                >
                  {busy === entry.userId ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
