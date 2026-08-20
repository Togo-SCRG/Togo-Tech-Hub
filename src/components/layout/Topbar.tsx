"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ActiveTimerBar } from "@/components/timetracker/ActiveTimerBar";
import { MobileNav } from "@/components/layout/MobileNav";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { EasternClock } from "@/components/layout/EasternClock";
import type { CurrentUser } from "@/types";

const PAGE_TITLES: { match: (p: string) => boolean; title: string }[] = [
  { match: (p) => p.startsWith("/dashboard"), title: "Dashboard" },
  { match: (p) => p.startsWith("/daily-updates"), title: "Daily Updates" },
  { match: (p) => p.startsWith("/projects"), title: "Projects" },
  { match: (p) => p.startsWith("/members"), title: "Team" },
  { match: (p) => p.startsWith("/notifications"), title: "Notifications" },
  { match: (p) => p.startsWith("/access"), title: "Access Levels" },
  { match: (p) => p.startsWith("/settings"), title: "Settings" },
];

export function Topbar({ user }: { user: CurrentUser | null }) {
  const pathname = usePathname();
  const title = PAGE_TITLES.find((p) => p.match(pathname))?.title ?? "";

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-togo-border bg-togo-charcoal/80 px-4 py-3 backdrop-blur sm:px-6 md:px-8">
      {user && <MobileNav isAdmin={user.isAdmin} isSuperAdmin={user.isSuperAdmin} isClient={user.isClient} />}
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="whitespace-nowrap text-base font-bold text-togo-white">{title}</h1>
      </div>
      <div className="flex-1" />
      {user && (
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ActiveTimerBar />
          <NotificationBell />
          {/* The theme toggle used to live in the sidebar footer, which now
              carries the account card instead. Here it sits with the other
              icon-sized controls. */}
          <ThemeToggle />
          {/* Clock icon rather than a bare string, so the date/time reads as a
              status readout and lines up with the icon buttons beside it. */}
          <span className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-togo-muted sm:flex">
            <Clock size={14} className="shrink-0 text-togo-faint" />
            <EasternClock />
          </span>
          {/* Identity lives in the sidebar footer on desktop; this stays for the
              viewports where the sidebar is hidden. */}
          <Link
            href="/settings"
            title="Your profile and settings"
            className="flex items-center gap-2.5 rounded-md px-1 py-0.5 transition-colors hover:bg-togo-surface/60 md:hidden"
          >
            <div className="hidden text-right sm:block">
              <div className="text-sm font-bold leading-tight text-togo-white">{user.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-togo-blue">{user.role}</div>
            </div>
            <Avatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
          </Link>
        </div>
      )}
    </header>
  );
}
