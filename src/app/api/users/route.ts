import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { invitableLevels } from "@/lib/accessLevels";
import { capabilitiesFor } from "@/lib/permissions";
import type { AccessLevel } from "@/types";

// Readable generated password — no characters that are ambiguous when read off
// a screen or retyped (0/O, 1/l/I), since it's passed on by hand.
const SAFE_CHARS = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += SAFE_CHARS[randomInt(SAFE_CHARS.length)];
  return out;
}

/**
 * Create a user account at a chosen access level, with a generated password
 * that's returned once so whoever created it can pass it on themselves. No
 * email is sent — deliberately, so the flow doesn't depend on SMTP being
 * configured or on an invitation link surviving a mail client.
 *
 * Admins and super admins may create accounts; a plain user may not. An admin
 * is capped at admin/user, because letting them mint a super admin would be a
 * privilege escalation — they could then use that account to grant themselves
 * anything. Enforced here, not just in the form, since the form is a client the
 * caller controls.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();

  const callerLevel = (callerProfile?.access_level as AccessLevel | undefined) ?? null;
  // invitableLevels is the no-escalation rule and stays in code: nobody may
  // create an account above their own tier, whatever the matrix says. The
  // matrix decides whether they may create accounts *at all*.
  const caps = await capabilitiesFor(supabase, callerLevel, user.id);
  const allowed = invitableLevels(callerLevel).filter((level) =>
    level === "client" ? caps.includes("team.client.add") : caps.includes("team.member.add")
  );

  if (allowed.length === 0) {
    return NextResponse.json({ error: "You don't have permission to create accounts." }, { status: 403 });
  }

  const body = await req.json();
  const { name, role, email, accessLevel = "user" } = body as {
    name?: string;
    role?: string;
    email?: string;
    accessLevel?: AccessLevel;
  };

  if (!name?.trim() || !role?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Name, role, and email are required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }
  if (!allowed.includes(accessLevel)) {
    return NextResponse.json(
      {
        error:
          accessLevel === "super_admin"
            ? "Only the super admin can create another super admin."
            : "You can't create an account at that access level.",
      },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const password = generatePassword();

  // email_confirm short-circuits the confirmation step: without it the account
  // exists but password sign-in is refused with "Email not confirmed", and
  // there's no email going out to confirm with.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim(), role: role.trim() },
  });

  if (createError || !created.user) {
    const message = createError?.message || "Failed to create the account.";
    const duplicate = /already|registered|exists/i.test(message);
    return NextResponse.json(
      { error: duplicate ? "Someone with that email already has an account." : message },
      { status: 400 }
    );
  }

  // handle_new_user (migration 001) already inserted a bare profiles row at the
  // default 'user' tier; set the details and requested level here. is_admin is
  // kept in sync by the sync_profiles_is_admin trigger (migration 012).
  //
  // Written with the service-role client rather than the caller's session: the
  // profiles_update_own_or_super_admin policy (migration 014) only allows
  // writing your own row unless you're the super admin, so an admin creating an
  // account would otherwise be denied here and leave it at the wrong tier. The
  // authorisation was already established above.
  const BASE_FIELDS = { name: name.trim(), role: role.trim(), access_level: accessLevel };
  const BASE_SELECT = "id, name, email, avatar_url, role, access_level";

  let { data: profile, error: updateError } = await admin
    .from("profiles")
    .update({
      ...BASE_FIELDS,
      // Marks the account as provisioned but not yet used, which is what drives
      // the "Pending" badge until their first sign-in clears it.
      invited_at: new Date().toISOString(),
    })
    .eq("id", created.user.id)
    .select(`${BASE_SELECT}, invited_at, signed_in_at`)
    .single();

  // invited_at only exists once migration 018 has been run. The account is
  // already created by this point, so retry without the column rather than
  // failing and leaving it at the default tier. PostgREST reports an unknown
  // column as PGRST204 from its schema cache; Postgres itself says 42703.
  const missingInviteColumn =
    updateError?.code === "PGRST204" ||
    updateError?.code === "42703" ||
    /invited_at|signed_in_at/.test(updateError?.message || "");

  if (missingInviteColumn) {
    ({ data: profile, error: updateError } = await admin
      .from("profiles")
      .update(BASE_FIELDS)
      .eq("id", created.user.id)
      .select(BASE_SELECT)
      .single());
  }

  if (updateError || !profile) {
    return NextResponse.json(
      {
        error: `The account was created, but its access level couldn't be set (${
          updateError?.message ?? "unknown error"
        }). Set it from the list below.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    member: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      role: profile.role,
      accessLevel: profile.access_level as AccessLevel,
      pending: true,
    },
    // Returned once, and never stored in plaintext anywhere. The caller is
    // expected to pass it on; if it's lost the account needs a new password.
    tempPassword: password,
  });
}
