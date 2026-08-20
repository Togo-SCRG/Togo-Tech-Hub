import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Request-scoped: the pages rendered inside this layout ask for the same
  // thing, and get this answer rather than repeating the three round trips it
  // took to build. See lib/auth.ts.
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

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
