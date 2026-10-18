import type { AccessLevel } from "@/types";

/**
 * "View as": a super admin previewing the app as another access level.
 *
 * Held in a cookie so every server render and API call in the session sees it.
 * It can only ever take power away — getCurrentUser() honours it solely for a
 * real super admin, and while it's set the middleware refuses every write. So a
 * cookie anyone sets by hand changes nothing but their own ability to save.
 *
 * Kept free of server-only imports: the middleware (edge) reads it too.
 */
export const VIEW_AS_COOKIE = "togo-view-as";

export const VIEW_AS_LEVELS = ["admin", "user", "client"] as const satisfies readonly AccessLevel[];
export type ViewAsLevel = (typeof VIEW_AS_LEVELS)[number];

export const VIEW_AS_LABELS: Record<ViewAsLevel, string> = {
  admin: "Admin",
  user: "User",
  client: "Client",
};

/** The previewed level, or null when the cookie is missing or holds anything else. */
export function parseViewAs(value: string | null | undefined): ViewAsLevel | null {
  return (VIEW_AS_LEVELS as readonly string[]).includes(value ?? "") ? (value as ViewAsLevel) : null;
}

/**
 * Ends any preview, from the browser. Called on sign-in and sign-out: the
 * cookie belongs to the browser, not the account, and the middleware's write
 * block can't tell whose it is — so a preview left running would otherwise
 * stop the next person to sign in on that browser from saving anything.
 * Never throws; there's usually nothing to clear.
 */
export async function clearViewAs(): Promise<void> {
  await fetch("/api/view-as", { method: "DELETE" }).catch(() => {});
}

/** Shown when a save is refused during a preview, by the middleware and the UI alike. */
export const VIEW_AS_READ_ONLY_MESSAGE = "You're previewing another access level, so changes are turned off — exit “View as” to make changes.";
