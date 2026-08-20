import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { capabilitiesFor } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { CurrentUser } from "@/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, avatar_url, role, is_admin, access_level")
    .eq("id", authUser.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  const capabilities = await capabilitiesFor(supabase, profile.access_level, profile.id);

  const user: CurrentUser = {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    role: profile.role,
    isAdmin: profile.is_admin,
    accessLevel: profile.access_level,
    isSuperAdmin: profile.access_level === "super_admin",
    isClient: profile.access_level === "client",
    // Mirrors the database rule (migration 029): clients are read-only.
    canEdit: profile.access_level !== "client",
    capabilities,
  };

  return (
    <div className="flex min-h-screen bg-togo-black">
      {/* Keyboard users can jump past the sidebar and topbar on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-togo-blue focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar isAdmin={user.isAdmin} isSuperAdmin={user.isSuperAdmin} isClient={user.isClient} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        {/* One container for every page. This used to be each page's own
            `max-w-* mx-auto` wrapper, which had drifted to four different
            widths — content jumped around as you navigated. Owning it here
            means new pages inherit it and can't drift again. */}
        <main id="main-content" className="flex-1 p-4 sm:p-5 md:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
