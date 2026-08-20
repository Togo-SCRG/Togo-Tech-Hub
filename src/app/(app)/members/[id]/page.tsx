"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  FolderKanban,
  Github,
  Mail,
  Phone,
  Settings as SettingsIcon,
  Trash2,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TierBadge } from "@/components/ui/TierBadge";
import { can } from "@/lib/capabilities";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { EditProfileModal } from "@/components/members/EditProfileModal";
import { MemberProjectModal } from "@/components/members/MemberProjectModal";
import { BackButton } from "@/components/layout/BackButton";
import { formatDateShort } from "@/lib/utils";
import type { CurrentUser, MemberItem, MemberProjectItem } from "@/types";

export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [member, setMember] = useState<MemberItem | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [allMembers, setAllMembers] = useState<MemberItem[]>([]);
  const [memberProjects, setMemberProjects] = useState<MemberProjectItem[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  // Opens on Projects: it's the first tab, and "what are they working on" is
  // the question this page is usually opened to answer.
  const [tab, setTab] = useState<"activity" | "projects">("projects");
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<MemberProjectItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingMember, setDeletingMember] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [memberRes, meRes, membersRes, memberProjectsRes, projectsRes] = await Promise.all([
      fetch(`/api/members/${params.id}`),
      fetch("/api/auth/me"),
      fetch("/api/members"),
      fetch(`/api/member-projects?userId=${params.id}`),
      fetch("/api/projects"),
    ]);
    if (memberRes.ok) {
      const data = await memberRes.json();
      setMember(data.member);
    }
    if (meRes.ok) {
      const data = await meRes.json();
      setCurrentUser(data.user);
    }
    if (membersRes.ok) {
      const data = await membersRes.json();
      setAllMembers(data.members);
    }
    if (memberProjectsRes.ok) {
      const data = await memberProjectsRes.json();
      setMemberProjects(data.projects);
    }
    if (projectsRes.ok) {
      const data = await projectsRes.json();
      setProjectNames(data.projects || []);
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !member) {
    return (
      <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading profile">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-center gap-5 rounded-md border border-togo-border bg-togo-charcoal p-6">
          <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
        </div>
        <Skeleton className="h-9 w-48" />
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
        </div>
      </div>
    );
  }

  // Client stakeholders (the admin tier) don't log updates or track time, so
  // their profile is a biography and contact card rather than the activity /
  // projects tabs a team member gets.
  const isClient = member.accessLevel === "client";
  const isOwnProfile = currentUser?.id === member.id;
  const canEdit = currentUser && (currentUser.isSuperAdmin || isOwnProfile);
  const canDeleteMember = can(currentUser?.capabilities, "member.delete") && !isOwnProfile;
  const projectsLabel = isOwnProfile ? "My Projects" : `${member.name}'s Projects`;
  const skills = (member.skills || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const updates = member.updates || [];
  const updatesByDate = updates.reduce<Record<string, typeof updates>>((acc, u) => {
    const key = formatDateShort(u.date);
    acc[key] = acc[key] || [];
    acc[key].push(u);
    return acc;
  }, {});

  function openAddProject() {
    setEditingProject(null);
    setProjectModalOpen(true);
  }

  function openEditProject(p: MemberProjectItem) {
    if (!canEdit) return;
    setEditingProject(p);
    setProjectModalOpen(true);
  }

  function resolvePartner(id: string) {
    return allMembers.find((m) => m.id === id);
  }

  async function handleDeleteMember() {
    setDeletingMember(true);
    setDeleteError(null);
    const deletedName = member!.name;
    const res = await fetch(`/api/members/${member!.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/members");
      router.refresh();
      // Fired before navigating away: the toast lives at the app layout level,
      // so it survives the route change and lands on the team list.
      toast.success(`${deletedName}'s account was deleted.`);
    } else {
      const data = await res.json();
      setDeleteError(data.error || "Failed to delete member.");
      setDeletingMember(false);
    }
  }

  /**
   * The badge shows the *project's* status, so changing it changes the project's
   * — the same edit the Projects list and the project's own page make, and
   * visible to everyone rather than only on this profile. Setting a status that
   * only this card could see is what made these cards disagree with the rest of
   * the app in the first place.
   */
  async function handleProjectStatusChange(p: MemberProjectItem, nextStatus: string) {
    // Every card for this project, not just the one clicked: one project can be
    // listed once per person, and they all read the same status.
    setMemberProjects((prev) =>
      prev.map((item) => (item.project === p.project ? { ...item, projectStatus: nextStatus } : item))
    );
    const res = await fetch("/api/project-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: p.project, status: nextStatus }),
    });
    // The badge was already flipped optimistically above, so without this a
    // rejected change just silently snapped back on the next load().
    if (res.ok) {
      toast.success(`${p.project} is now ${nextStatus}.`);
    } else {
      load();
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || `Couldn't update the status for ${p.project}.`);
    }
  }

  return (
    <div className="space-y-6">
      <BackButton label="Back to team" fallbackHref="/members" />
      <div className="flex flex-col justify-between gap-5 rounded-md border border-togo-border bg-togo-charcoal p-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-5">
          {/* Only a real uploaded photo is worth enlarging — the initials
              fallback is generated at whatever size it's asked for, so a
              lightbox of it would show nothing you can't already see. */}
          {member.avatarUrl ? (
            <button
              type="button"
              onClick={() => setPhotoPreviewOpen(true)}
              title={`View ${member.name}'s photo`}
              aria-label={`View ${member.name}'s photo`}
              className="shrink-0 rounded-full ring-offset-2 ring-offset-togo-charcoal transition-shadow hover:ring-2 hover:ring-togo-blue focus-visible:ring-2 focus-visible:ring-togo-blue"
            >
              <Avatar name={member.name} avatarUrl={member.avatarUrl} size="lg" />
            </button>
          ) : (
            <Avatar name={member.name} avatarUrl={member.avatarUrl} size="lg" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold text-togo-white">{member.name}</h1>
              {member.accessLevel && <TierBadge tier={member.accessLevel} />}
            </div>
            <p className="text-sm font-semibold uppercase tracking-wide text-togo-blue">{member.role}</p>
            {/* A client's biography is long-form and gets its own panel below,
                so it isn't crammed into the header alongside everything else. */}
            {!isClient && member.bio && <p className="mt-2 max-w-md text-sm text-togo-muted">{member.bio}</p>}
            {!isClient && member.githubUrl && (
              <a
                href={member.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-togo-muted transition-colors hover:text-togo-blue"
              >
                <Github size={14} /> {member.githubUrl.replace("https://github.com/", "")}
              </a>
            )}
          </div>
        </div>
        {/* Your own details live in Settings, which owns the account as a whole
            (email, password, theme). Editing them in a modal here as well would
            mean two places to keep in step. Editing *someone else's* profile —
            super admin only — still happens in the modal. */}
        {isOwnProfile ? (
          <Link href="/settings">
            <Button variant="secondary">
              <SettingsIcon size={14} /> Edit profile
            </Button>
          </Link>
        ) : (
          canEdit && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit profile
            </Button>
          )
        )}
      </div>

      {isClient ? (
        <>
          {member.bio && (
            <section className="rounded-md border border-togo-border bg-togo-surface p-6">
              <h2 className="section-label mb-3">About</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-togo-muted">{member.bio}</p>
            </section>
          )}

          {(member.phone || member.email) && (
            <section className="rounded-md border border-togo-border bg-togo-surface p-6">
              <h2 className="section-label mb-3">Contact</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
                {member.phone && (
                  <a
                    href={`tel:${member.phone.replace(/[^\d+]/g, "")}`}
                    className="flex items-center gap-2.5 text-sm text-togo-white transition-colors hover:text-togo-blue"
                  >
                    <Phone size={15} className="shrink-0 text-togo-blue" />
                    <span className="tnum">{member.phone}</span>
                  </a>
                )}
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="flex min-w-0 items-center gap-2.5 text-sm text-togo-white transition-colors hover:text-togo-blue"
                  >
                    <Mail size={15} className="shrink-0 text-togo-blue" />
                    <span className="truncate">{member.email}</span>
                  </a>
                )}
              </div>
            </section>
          )}

          {!member.bio && !member.phone && !member.email && (
            <EmptyState
              icon={UserRound}
              title="No profile details yet"
              description={
                canEdit
                  ? "Add a biography and contact details so the team knows who to reach and what they cover."
                  : `${member.name} hasn't added a biography or contact details yet.`
              }
              action={
                isOwnProfile ? (
                  <Link href="/settings">
                    <Button size="sm">Edit profile</Button>
                  </Link>
                ) : canEdit ? (
                  <Button size="sm" onClick={() => setEditOpen(true)}>
                    Edit profile
                  </Button>
                ) : undefined
              }
            />
          )}
        </>
      ) : (
        <>
          {skills.length > 0 && (
            <div>
              <p className="section-label mb-2">Skills</p>
              <div className="flex flex-wrap gap-2">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-togo-blue bg-togo-surface px-3 py-1.5 text-xs font-medium text-togo-blue"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div role="tablist" aria-label="Profile sections" className="flex gap-2 border-b border-togo-border">
        {(["projects", "activity"] as const).map((t) => {
          const count = t === "activity" ? updates.length : memberProjects.length;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={
                "-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold capitalize transition-colors " +
                (tab === t
                  ? "border-togo-blue text-togo-blue"
                  : "border-transparent text-togo-muted hover:text-togo-white")
              }
            >
              {t}
              <span
                className={
                  "tnum rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                  (tab === t ? "bg-togo-blue/15 text-togo-blue" : "bg-togo-surface-2 text-togo-faint")
                }
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "activity" && (
        <div className="space-y-6">
          {Object.keys(updatesByDate).length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No updates logged yet"
              description={
                isOwnProfile
                  ? "Your daily updates will appear here once you start logging them."
                  : `${member.name} hasn't logged any daily updates yet.`
              }
              action={
                isOwnProfile ? (
                  <Link href="/daily-updates?logUpdate=1">
                    <Button size="sm">Log an update</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            Object.entries(updatesByDate).map(([date, items]) => (
              <div key={date}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="section-label">{date}</p>
                  <div className="h-px flex-1 bg-togo-border" />
                </div>
                <div className="space-y-2">
                  {items.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-start justify-between gap-4 rounded-md border border-togo-border bg-togo-surface p-4"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-togo-white">{u.project}</div>
                        <div className="mt-1 text-sm leading-relaxed text-togo-muted">
                          {u.update || <span className="text-togo-faint">—</span>}
                        </div>
                      </div>
                      <StatusBadge status={u.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "projects" && (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="section-label">{projectsLabel}</p>
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={openAddProject}>
                  Add Project
                </Button>
              )}
            </div>

            {memberProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects added yet"
                description={
                  canEdit
                    ? "Add a project to record the role and any co-developers working alongside it."
                    : `${member.name} isn't assigned to any projects yet.`
                }
                action={
                  canEdit ? (
                    <Button size="sm" onClick={openAddProject}>
                      Add project
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {memberProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => openEditProject(p)}
                    className={
                      "space-y-3 rounded-md border border-togo-border bg-togo-surface p-4" +
                      (canEdit ? " card-hover cursor-pointer hover:border-togo-blue" : "")
                    }
                    title={canEdit ? "Click to edit this project" : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-togo-white">{p.project}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <StatusBadge
                          status={p.projectStatus || p.status}
                          onClick={canEdit ? (s) => handleProjectStatusChange(p, s) : undefined}
                        />
                      </div>
                    </div>
                    {p.role && <p className="text-xs text-togo-blue font-medium">{p.role}</p>}
                    {p.partnerIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {p.partnerIds.map((id) => {
                          const partner = resolvePartner(id);
                          if (!partner) return null;
                          return (
                            <Link
                              key={id}
                              href={`/members/${id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-xs text-togo-muted hover:text-togo-blue transition-colors"
                            >
                              <Avatar name={partner.name} avatarUrl={partner.avatarUrl} size="sm" />
                              {partner.name}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
          )}
        </>
      )}

      {/* Projects tab only. This sat outside both tabs, so it showed up under
          the activity feed too — the same destructive action twice on one page,
          in the tab that has nothing to do with managing the account. */}
      {canDeleteMember && tab === "projects" && (
        <div className="space-y-4 rounded-md border border-[var(--status-blocked-border)] bg-togo-surface p-6">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--status-blocked-fg)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--status-blocked-fg)]">Danger zone</p>
              <p className="mt-1 text-sm text-togo-muted">
                Permanently delete {member.name}&apos;s account, including their profile, updates, time entries, and
                projects. This can&apos;t be undone.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => setDeleteConfirmOpen(true)}
            className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
          >
            <Trash2 size={14} /> Delete member
          </Button>
        </div>
      )}

      {/* Own-profile edits go to Settings, so this modal is only for a super
          admin editing another member. */}
      {canEdit && !isOwnProfile && (
        <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={load} member={member} />
      )}

      {canEdit && (
        <MemberProjectModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          onSaved={load}
          ownerId={member.id}
          members={allMembers}
          editingProject={editingProject}
          existingProjects={projectNames}
        />
      )}

      {canDeleteMember && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          title="Delete Member"
          description={`Are you sure you want to permanently delete ${member.name}'s account? This removes their profile and all their updates, time entries, and projects. This can't be undone.${
            deleteError ? ` ${deleteError}` : ""
          }`}
          confirmLabel="Delete"
          danger
          loading={deletingMember}
          onConfirm={handleDeleteMember}
          onCancel={() => {
            setDeleteConfirmOpen(false);
            setDeleteError(null);
          }}
        />
      )}

      {member.avatarUrl && (
        <ImageLightbox
          open={photoPreviewOpen}
          onClose={() => setPhotoPreviewOpen(false)}
          src={member.avatarUrl}
          alt={`${member.name}'s profile photo`}
          caption={member.name}
        />
      )}
    </div>
  );
}
