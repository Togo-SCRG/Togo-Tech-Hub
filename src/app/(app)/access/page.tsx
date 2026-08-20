import { redirect } from "next/navigation";
import { ShieldCheck, Info, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { compareByRole } from "@/lib/utils";
import { AccessLevelsTable } from "@/components/access/AccessLevelsTable";
import { CreateUserButton } from "@/components/access/CreateUserButton";
import { PermissionMatrix } from "@/components/access/PermissionMatrix";
import type { AccessLevel } from "@/types";

export interface AccessMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  accessLevel: AccessLevel;
  /** Invited but never signed in — the invitation is still outstanding. */
  pending: boolean;
  invitedAt: string | null;
}

/**
 * What each tier can do *by default* — the seeded permission matrix from
 * migrations 032 and 034.
 *
 * Static copy rather than derived from the live matrix, because the matrix is
 * only editable (and only fetched in full) by the super admin, while these
 * cards are shown to everyone. The trade-off is that they can go stale: if you
 * change a tier's permissions, the wording here needs updating too. The note
 * under the cards says as much, so nobody reads them as gospel.
 */
const TIER_INFO: {
  tier: AccessLevel;
  label: string;
  color: string;
  perms: string[];
}[] = [
  {
    tier: "super_admin",
    label: "Super admin",
    color: "text-togo-blue",
    perms: [
      "Full control over all data",
      "Sets every tier's permissions",
      "Create and delete projects",
      "Log updates for anyone",
      "Edit any member profile",
    ],
  },
  {
    tier: "admin",
    label: "Admin",
    color: "text-[#9b6fd4]",
    perms: [
      "Manage any project or hour cap",
      "Own updates only, by default",
      "Create and delete projects",
      "See every member's tasks",
      "Cannot delete accounts",
    ],
  },
  {
    tier: "client",
    label: "Client",
    color: "text-[#e0a03a]",
    perms: [
      "Watch every project's progress",
      "Set status, timeline and cap",
      "Create projects, add clients",
      "Cannot log updates or time",
      "Cannot delete projects",
    ],
  },
  {
    tier: "user",
    label: "User",
    color: "text-togo-muted",
    perms: [
      "Log own updates and time",
      "Create projects, not delete",
      "Set status on their projects",
      "Assign people to a project",
      "Sees only their own tasks",
    ],
  },
];

export default async function AccessLevelsPage() {
  const supabase = createClient();

  const me = await getCurrentUser();
  if (!me) redirect("/login");

  // Readable by the whole team — knowing who can do what isn't privileged
  // information. Only the super admin can change a tier; everyone else gets
  // the same page without the controls.
  const myLevel = me.accessLevel ?? "user";
  const canEdit = myLevel === "super_admin";

  // invited_at/signed_in_at arrive with migration 018. Selecting a column that
  // doesn't exist fails the whole query, so fall back to the base columns
  // rather than emptying the page on a database where it hasn't been run.
  const BASE_COLUMNS = "id, name, avatar_url, role, access_level";
  let { data: profiles } = await supabase.from("profiles").select(`${BASE_COLUMNS}, invited_at, signed_in_at`);
  if (!profiles) {
    ({ data: profiles } = await supabase.from("profiles").select(BASE_COLUMNS));
  }

  const members: AccessMember[] = (profiles ?? [])
    .map((p) => {
      const invitedAt = "invited_at" in p ? (p.invited_at as string | null) : null;
      const signedInAt = "signed_in_at" in p ? (p.signed_in_at as string | null) : null;
      return {
        id: p.id,
        name: p.name,
        avatarUrl: p.avatar_url,
        role: p.role,
        accessLevel: p.access_level as AccessLevel,
        // Seeded accounts have no invited_at, so they're never "pending" even
        // though some may not have signed in yet.
        pending: !!invitedAt && !signedInAt,
        invitedAt,
      };
    })
    .sort(compareByRole);

  const pendingCount = members.filter((m) => m.pending).length;

  const counts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.accessLevel] = (acc[m.accessLevel] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Titled by the topbar; only the explanation is left here.
              items-start, not items-center: the description wraps to two lines
              on a narrow screen and the icon should stay on the first. */}
          <p className="flex items-start gap-1.5 text-sm text-togo-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-togo-blue" />
            <span>
              {canEdit
                ? "What each tier can do, and which tier every member is on. You can change a member's tier below."
                : "What each tier can do, and which tier every member is on. Only the super admin can change these."}
            </span>
          </p>
        </div>
        {/* Renders nothing for a plain user, who can't create accounts. */}
        <CreateUserButton callerLevel={myLevel} />
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TIER_INFO.map((t) => (
          <div key={t.tier} className="card-hover space-y-3 rounded-md border border-togo-border bg-togo-surface p-5">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${t.color}`}>{t.label}</span>
              <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
                {counts[t.tier] ?? 0} member{(counts[t.tier] ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="space-y-1.5">
              {t.perms.map((p) => (
                <li key={p} className="flex items-start gap-2 text-xs leading-snug text-togo-muted">
                  <Check size={13} className={`mt-px shrink-0 ${t.color}`} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* These are the defaults, not a fixed rule — the super admin can grant or
          revoke any of them per tier, or for one person. Saying so here stops
          the cards being read as the last word. */}
      <p className="text-[11px] leading-relaxed text-togo-faint">
        Defaults. The super admin can change what any tier can do, and can give one person more or less than their
        tier allows — so an admin can be granted the ability to log updates for the team, or a client can have
        project editing taken away.
      </p>

      <AccessLevelsTable
        initialMembers={members}
        currentUserId={me.id}
        canEdit={canEdit}
        pendingCount={pendingCount}
      />

      {/* Super admin only. Nobody else can change any of it, and a read-only
          grid of sixteen capabilities was a lot of page for information the
          tier cards above already summarise. */}
      {canEdit && (
        <PermissionMatrix
          people={members.map((m) => ({
            id: m.id,
            name: m.name,
            avatarUrl: m.avatarUrl,
            accessLevel: m.accessLevel,
          }))}
        />
      )}

      <div className="flex gap-3 rounded-md border border-togo-blue/30 bg-togo-blue/[0.04] p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-togo-blue" />
        <div className="text-sm leading-relaxed text-togo-muted">
          <p className="font-bold text-togo-blue mb-1">Row Level Security (RLS)</p>
          Authorization lives in Postgres, not in app code. Every API route queries Supabase as the
          signed-in user, and RLS policies enforce who can read or write each row — they ask{" "}
          <code className="text-togo-blue">has_permission()</code>, which reads the permission tables the
          super admin maintains. So a revoked permission doesn&apos;t just hide a button; the database
          refuses the write.
        </div>
      </div>
    </div>
  );
}
