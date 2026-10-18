"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { LINK_CATEGORIES } from "@/lib/resources";
import type { ResourceLink, ResourceLinkCategory } from "@/types";

/**
 * Add a link to the library, or edit one. "Official website" is offered to
 * admins only — the database refuses it from anyone else regardless — and
 * setting it moves the title from whichever link held it.
 */
export function LinkFormModal({
  open,
  onClose,
  editing,
  canSetOfficial,
  presetOfficial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing?: ResourceLink | null;
  canSetOfficial: boolean;
  /** Opened from "Add the official website": start with it ticked, as a Company link. */
  presetOfficial?: boolean;
  onSaved: (link: ResourceLink) => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(editing?.label ?? (presetOfficial ? "Togo — official website" : ""));
  const [url, setUrl] = useState(editing?.url ?? "");
  const [category, setCategory] = useState<ResourceLinkCategory>(editing?.category ?? (presetOfficial ? "company" : "tool"));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [isOfficial, setIsOfficial] = useState(editing?.isOfficial ?? !!presetOfficial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(editing ? `/api/resource-links/${editing.id}` : "/api/resource-links", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        url,
        category,
        description,
        pinned,
        ...(canSetOfficial ? { isOfficial } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Couldn't save the link.");
      return;
    }
    toast.success(editing ? "Link updated." : `“${data.link.label}” added.`);
    onSaved(data.link);
    onClose();
  }

  const hint = LINK_CATEGORIES.find((c) => c.value === category)?.hint;

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit link" : presetOfficial ? "Official website" : "Add a link"} className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="link-label">Label</Label>
          <Input
            id="link-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What it is — e.g. Staging site, Brand guidelines"
            autoFocus={!presetOfficial}
            required
          />
        </div>
        <div>
          <Label htmlFor="link-url">Address</Label>
          <Input
            id="link-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
            autoFocus={presetOfficial}
            required
          />
        </div>
        <div>
          <Label htmlFor="link-category">Category</Label>
          <Select id="link-category" value={category} onChange={(e) => setCategory(e.target.value as ResourceLinkCategory)}>
            {LINK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          {hint && <p className="mt-1 text-[11px] text-togo-faint">{hint}.</p>}
        </div>
        <div>
          <Label htmlFor="link-description" hint="Optional">
            Description
          </Label>
          <Textarea
            id="link-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything worth knowing — who has the login, what it's for"
          />
        </div>

        <div className="space-y-2 rounded-md border border-togo-border bg-togo-surface-2/30 p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#0797DF]"
            />
            <span>
              <span className="block text-sm font-medium text-togo-white">Pin to the dashboard</span>
              <span className="block text-xs text-togo-faint">Shows in Quick links on everyone&apos;s dashboard.</span>
            </span>
          </label>
          {canSetOfficial && (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={isOfficial}
                onChange={(e) => setIsOfficial(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#0797DF]"
              />
              <span>
                <span className="block text-sm font-medium text-togo-white">This is Togo&apos;s official website</span>
                <span className="block text-xs text-togo-faint">
                  Featured at the top of the dashboard for everyone, clients included. Only one link can be the official
                  website.
                </span>
              </span>
            </label>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--status-blocked-fg)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Add link"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
