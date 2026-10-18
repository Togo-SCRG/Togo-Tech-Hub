"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IntentLink } from "@/components/ui/IntentLink";
import {
  Eye,
  EyeOff,
  ExternalLink,
  Keyboard,
  KeyRound,
  LogOut,
  Palette,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import { TierBadge } from "@/components/ui/TierBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeSelector } from "@/components/ui/ThemeSelector";
import { ShortcutsModal } from "@/components/ui/ShortcutsModal";
import { AvatarUploadField } from "@/components/members/AvatarUploadField";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { clearViewAs } from "@/lib/viewAs";
import { invalidateCurrentUser } from "@/lib/useCurrentUser";
import type { CurrentUser, MemberItem } from "@/types";

const TIER_SUMMARY: Record<string, string> = {
  super_admin: "Full control over all data, members and access levels.",
  admin: "Manage projects and log updates for anyone on the team.",
  user: "Log your own updates and time, and view assigned projects.",
};

function Card({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("space-y-4 rounded-md border border-togo-border bg-togo-surface p-5", className)}
    >
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-togo-blue">
          <Icon size={16} /> {title}
        </h2>
        {description && <p className="mt-1 text-xs text-togo-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<CurrentUser | null>(null);

  // Profile fields. `saved` holds what's currently persisted so the form can
  // tell whether anything actually changed and offer a discard.
  const [saved, setSaved] = useState<Partial<MemberItem>>({});
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) return;
      const { user: me } = await meRes.json();
      setUser(me);
      if (!me) return;

      // /api/auth/me omits bio/skills/github, so pull the full profile row.
      const memberRes = await fetch(`/api/members/${me.id}`);
      const profile: Partial<MemberItem> = memberRes.ok ? (await memberRes.json()).member : {};

      setSaved({
        name: profile.name ?? me.name,
        role: profile.role ?? me.role,
        bio: profile.bio ?? "",
        skills: profile.skills ?? "",
        githubUrl: profile.githubUrl ?? "",
        phone: profile.phone ?? "",
        email: profile.email ?? me.email ?? "",
        avatarUrl: profile.avatarUrl ?? me.avatarUrl ?? "",
      });
      setName(profile.name ?? me.name ?? "");
      setRole(profile.role ?? me.role ?? "");
      setBio(profile.bio ?? "");
      setSkills(profile.skills ?? "");
      setGithubUrl(profile.githubUrl ?? "");
      setPhone(profile.phone ?? "");
      setEmail(profile.email ?? me.email ?? "");
      setAvatarUrl(profile.avatarUrl ?? me.avatarUrl ?? "");
    }
    load();
  }, []);

  async function saveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    const payload = {
      name: name.trim(),
      role: role.trim(),
      bio: bio.trim(),
      skills: skills.trim(),
      githubUrl: githubUrl.trim(),
      phone: phone.trim(),
      email: email.trim(),
      avatarUrl,
    };
    const res = await fetch(`/api/members/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // The route treats an email change as a sign-in change and updates
      // auth.users alongside the profile row; sending it unchanged is a no-op.
      body: JSON.stringify(payload),
    });
    setSavingProfile(false);
    if (res.ok) {
      setSaved(payload);
      toast.success("Profile updated.");
      // Other pages read the signed-in user from a shared cache; drop it so
      // they pick up the new name/photo instead of the stale one.
      invalidateCurrentUser();
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to update profile.");
    }
  }

  function discardChanges() {
    setName(saved.name ?? "");
    setRole(saved.role ?? "");
    setBio(saved.bio ?? "");
    setSkills(saved.skills ?? "");
    setGithubUrl(saved.githubUrl ?? "");
    setPhone(saved.phone ?? "");
    setEmail(saved.email ?? "");
    setAvatarUrl(saved.avatarUrl ?? "");
  }

  async function savePassword(e?: React.FormEvent) {
    e?.preventDefault();
    setSavingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password changed.");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswords(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    // While the session still exists — the route that clears it needs one.
    await clearViewAs();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading your account">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Skeleton className="h-[560px] rounded-md" />
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-md" />
            <Skeleton className="h-64 rounded-md" />
            <Skeleton className="h-40 rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  const profileChanged =
    name.trim() !== (saved.name ?? "") ||
    role.trim() !== (saved.role ?? "") ||
    bio.trim() !== (saved.bio ?? "") ||
    skills.trim() !== (saved.skills ?? "") ||
    githubUrl.trim() !== (saved.githubUrl ?? "") ||
    phone.trim() !== (saved.phone ?? "") ||
    email.trim() !== (saved.email ?? "") ||
    avatarUrl !== (saved.avatarUrl ?? "");

  // Clients are stakeholders, not contributors — skills and a GitHub link mean
  // nothing on their profile, matching how EditProfileModal treats them.
  const isClient = user.accessLevel === "client";
  const nameMissing = name.trim() === "";
  const githubInvalid = githubUrl.trim() !== "" && !/^https?:\/\/(www\.)?github\.com\/.+/i.test(githubUrl.trim());
  const emailChanged = email.trim().toLowerCase() !== (saved.email ?? "").toLowerCase();
  const emailInvalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSaveProfile = profileChanged && !nameMissing && !githubInvalid && !emailInvalid;

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 6;
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSavePassword = newPassword.length >= 6 && newPassword === confirmPassword;

  const skillList = skills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {/* No page heading here — the topbar already names the page, and two
          copies of the same word stacked on top of each other is just noise. */}
      <div className="flex flex-wrap items-end justify-end gap-3">
        <IntentLink
          href={`/members/${user.id}`}
          className="flex items-center gap-1.5 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
        >
          View public profile <ExternalLink size={12} />
        </IntentLink>
      </div>

      {/* No items-start: both columns stretch to the same height, so the two
          panels line up top and bottom instead of one running past the other. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* Profile — everything the old page sent you to another screen's modal for. */}
        <form onSubmit={saveProfile} className="flex">
          <Card
            icon={UserCircle}
            title="Profile"
            description="How you appear across the hub, on your profile page and in team lists."
            className="flex w-full flex-col"
          >
            <AvatarUploadField memberId={user.id} name={name || user.name} avatarUrl={avatarUrl} onChange={setAvatarUrl} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="settings-name" required>
                  Full name
                </Label>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  aria-invalid={nameMissing}
                />
                {nameMissing && (
                  <p className="mt-1.5 text-[11px] text-[var(--status-blocked-fg)]">A name is required.</p>
                )}
              </div>
              <div>
                <Label htmlFor="settings-role" hint="e.g. Backend Engineer">
                  Role
                </Label>
                <Input id="settings-role" value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="settings-bio" hint={isClient ? "Shown as your About section" : `${bio.length}/280`}>
                Bio
              </Label>
              {/* resize-y overrides Textarea's default resize-none, so this can
                  be dragged taller like the bullet fields in the update form. */}
              <Textarea
                id="settings-bio"
                className="resize-y"
                rows={isClient ? 8 : 3}
                // Clients have a long-form biography; a team member's bio is a
                // one-liner in the profile header, so it stays capped.
                maxLength={isClient ? undefined : 280}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={
                  isClient
                    ? "Background, experience and focus at Togo."
                    : "A sentence or two about what you work on."
                }
              />
            </div>

            {!isClient && (
            <>
            <div>
              <Label htmlFor="settings-skills" hint="Comma-separated">
                Skills
              </Label>
              {/* A textarea rather than an input purely so it can be dragged
                  taller — a long comma-separated list is unreadable scrolling
                  sideways in a one-line field. Still one value, still commas. */}
              <Textarea
                id="settings-skills"
                rows={2}
                className="resize-y"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="React, TypeScript, Postgres"
              />
              {skillList.length > 0 && (
                // Live preview of how the tags will render on the profile page,
                // so a stray comma is obvious before saving.
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skillList.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-togo-blue bg-togo-surface px-2.5 py-0.5 text-[11px] font-medium text-togo-blue"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="settings-github">GitHub URL</Label>
              <Input
                id="settings-github"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/username"
                inputMode="url"
                aria-invalid={githubInvalid}
                aria-describedby={githubInvalid ? "settings-github-error" : undefined}
              />
              {githubInvalid && (
                <p id="settings-github-error" className="mt-1.5 text-[11px] text-[var(--status-hold-fg)]">
                  That doesn&apos;t look like a GitHub profile URL.
                </p>
              )}
            </div>
            </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="settings-email" required hint="Also your sign-in address">
                  Email
                </Label>
                <Input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  aria-invalid={emailInvalid}
                  aria-describedby={emailInvalid ? "settings-email-error" : emailChanged ? "settings-email-note" : undefined}
                />
                {emailInvalid ? (
                  <p id="settings-email-error" className="mt-1.5 text-[11px] text-[var(--status-blocked-fg)]">
                    Enter a valid email address.
                  </p>
                ) : (
                  emailChanged && (
                    <p id="settings-email-note" className="mt-1.5 text-[11px] text-[var(--status-hold-fg)]">
                      You&apos;ll sign in with this address from now on.
                    </p>
                  )
                )}
              </div>
              <div>
                <Label htmlFor="settings-phone">Phone</Label>
                <Input
                  id="settings-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-togo-border pt-4">
              <div>
                <p className="text-xs font-medium text-togo-muted">Access tier</p>
                <p className="text-xs text-togo-faint">{TIER_SUMMARY[user.accessLevel] ?? ""}</p>
              </div>
              <TierBadge tier={user.accessLevel} />
            </div>

            {/* mt-auto so Save sits at the bottom of the stretched card rather
                than floating just under the last field. */}
            <div className="mt-auto flex items-center justify-end gap-3 border-t border-togo-border pt-4">
              {profileChanged && !savingProfile && (
                <>
                  <span className="mr-auto text-[11px] text-[var(--status-hold-fg)]">Unsaved changes</span>
                  <Button type="button" variant="ghost" size="sm" onClick={discardChanges}>
                    Discard
                  </Button>
                </>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={savingProfile || !canSaveProfile}
                title={profileChanged ? undefined : "Nothing to save yet"}
              >
                {savingProfile ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </Card>
        </form>

        <div className="space-y-4">
          <Card icon={Palette} title="Appearance" description="Applies immediately and is remembered on this device.">
            <ThemeSelector />
          </Card>

          <form onSubmit={savePassword}>
            <Card icon={KeyRound} title="Change password" description="You'll stay signed in on this device.">
              <div>
                <Label htmlFor="settings-new-password" required hint="At least 6 characters">
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="settings-new-password"
                    type={showPasswords ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="pr-10"
                    aria-invalid={passwordTooShort}
                    aria-describedby={passwordTooShort ? "settings-password-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                    title={showPasswords ? "Hide passwords" : "Show passwords"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-togo-faint transition-colors hover:text-togo-muted"
                  >
                    {showPasswords ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {passwordTooShort && (
                  <p id="settings-password-error" className="mt-1.5 text-[11px] text-[var(--status-hold-fg)]">
                    {6 - newPassword.length} more character{6 - newPassword.length === 1 ? "" : "s"} needed.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="settings-confirm-password" required>
                  Confirm new password
                </Label>
                <Input
                  id="settings-confirm-password"
                  type={showPasswords ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  aria-invalid={passwordMismatch}
                  aria-describedby={passwordMismatch ? "settings-confirm-error" : undefined}
                />
                {passwordMismatch && (
                  <p id="settings-confirm-error" className="mt-1.5 text-[11px] text-[var(--status-blocked-fg)]">
                    These passwords don&apos;t match.
                  </p>
                )}
                {canSavePassword && (
                  <p className="mt-1.5 text-[11px] text-[var(--status-completed-fg)]">Passwords match.</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={savingPassword || !canSavePassword}
                  title={canSavePassword ? undefined : "Enter and confirm a password of at least 6 characters"}
                >
                  {savingPassword ? "Updating..." : "Update password"}
                </Button>
              </div>
            </Card>
          </form>

          <Card icon={Keyboard} title="Keyboard shortcuts" description="Move around the hub without the mouse.">
            <Button type="button" size="sm" variant="secondary" onClick={() => setShortcutsOpen(true)}>
              View shortcuts
            </Button>
          </Card>

          {user.isSuperAdmin && (
            <Card icon={ShieldCheck} title="Administration" description="Manage who can see and change what.">
              <IntentLink href="/access">
                <Button type="button" size="sm" variant="secondary">
                  Manage access levels
                </Button>
              </IntentLink>
            </Card>
          )}

          <Card icon={LogOut} title="Session" description="Sign out of the Togo Tech Hub on this device.">
            <Button type="button" size="sm" variant="danger" onClick={() => setLogoutConfirmOpen(true)}>
              <LogOut size={14} /> Log Out
            </Button>
          </Card>
        </div>
      </div>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ConfirmDialog
        open={logoutConfirmOpen}
        title="Log Out"
        description="Are you sure you want to log out of the Togo Tech Hub?"
        confirmLabel="Log Out"
        danger
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
