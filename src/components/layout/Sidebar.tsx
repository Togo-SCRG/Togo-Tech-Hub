"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  FolderKanban,
  Users,
  Settings,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Avatar } from "@/components/ui/Avatar";
import { TogoLogo } from "./TogoLogo";
import type { CurrentUser } from "@/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: "menu" | "admin";
}

// Notifications deliberately isn't here — it's reached from the bell in the
// topbar, which carries the unread badge. The /notifications page still exists
// for the bell's "View all" link.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getNavItems(isAdmin: boolean, _isSuperAdmin = false, isClient = false): NavItem[] {
  return [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "menu" as const },
    // One label for everyone. What differs by tier is whose updates you see,
    // and the All / My tabs on the page itself say that far more clearly than
    // two different nav labels did.
    { href: "/daily-updates", label: "Daily Updates", icon: ClipboardList, section: "menu" as const },
    // Tasks live here too, as a second tab — they're the other half of the same
    // list, so a separate nav item made them look like a separate concern.
    { href: "/projects", label: "Projects", icon: FolderKanban, section: "menu" as const },
    { href: "/members", label: "Team", icon: Users, section: "menu" as const },
    // Everyone can see who holds which tier; only the super admin can change
    // one, which the page itself enforces.
    { href: "/access", label: "Access Levels", icon: ShieldCheck, section: "admin" as const },
    { href: "/settings", label: "Settings", icon: Settings, section: "admin" as const },
  ];
}

const COLLAPSE_KEY = "togo-sidebar-collapsed";

export function Sidebar({
  isAdmin,
  isSuperAdmin = false,
  isClient = false,
  user,
}: {
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  isClient?: boolean;
  user?: CurrentUser | null;
}) {
  const NAV_ITEMS = getNavItems(isAdmin, isSuperAdmin, isClient);
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 bg-togo-charcoal border-r border-togo-border h-screen sticky top-0 transition-[width] duration-200",
        collapsed ? "w-20" : "w-60"
      )}
    >
      {/* The collapse control lives in the footer now, next to Out — the two
          sidebar-level actions read as a pair there, and the header is left to
          the brand alone. */}
      <div className="border-b border-togo-border px-4 py-5">
        <div className="flex flex-col items-center gap-2">
          <TogoLogo compact={collapsed} />
          {!collapsed && (
            <span className="text-xs font-bold text-togo-muted uppercase tracking-wide text-center whitespace-nowrap">
              Togo Tech Hub
            </span>
          )}
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 px-2 py-3">
        {(["menu", "admin"] as const).map((section) => {
          const items = NAV_ITEMS.filter((i) => i.section === section);
          if (items.length === 0) return null;
          return (
            <div key={section} className={section === "admin" ? "mt-4" : ""}>
              {!collapsed ? (
                <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-togo-faint">
                  {section === "menu" ? "Menu" : "Admin"}
                </div>
              ) : (
                // Keeps the visual gap between groups when labels are hidden.
                section === "admin" && <div className="mx-auto mb-2 h-px w-8 bg-togo-border" />
              )}
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "mb-0.5 flex items-center gap-2.5 rounded-md border-l-2 py-2 text-xs font-medium transition-colors",
                      collapsed ? "justify-center px-0" : "px-3",
                      active
                        ? "border-togo-blue bg-togo-blue/10 text-togo-blue"
                        : "border-transparent text-togo-muted hover:bg-togo-surface/40 hover:text-togo-white"
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Who you're signed in as, then the two sidebar actions. The theme
          toggle moved to the topbar so it sits with the other icon controls;
          this footer is now identity + the actions that act on the sidebar
          itself. */}
      <div className={cn("border-t border-togo-border", collapsed ? "space-y-2 p-2" : "space-y-2.5 p-3")}>
        {user && (
          <Link
            href="/settings"
            title={collapsed ? `${user.name} — profile and settings` : "Your profile and settings"}
            className={cn(
              "flex items-center rounded-md border border-transparent transition-colors hover:border-togo-border hover:bg-togo-surface",
              collapsed ? "justify-center p-1" : "gap-2.5 bg-togo-surface/60 p-2.5"
            )}
          >
            {/* Squared-off rather than the circle used elsewhere: at this size
                it reads as an account tile, not another avatar in a stack. */}
            <Avatar name={user.name} avatarUrl={user.avatarUrl} size="sm" className="rounded-lg" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold leading-tight text-togo-white">{user.name}</div>
                <div className="truncate text-[11px] leading-tight text-togo-blue">{user.email}</div>
              </div>
            )}
          </Link>
        )}

        <div className={cn(collapsed ? "space-y-2" : "grid grid-cols-2 gap-2")}>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border border-togo-border bg-togo-surface/40 py-2 text-xs font-medium text-togo-muted transition-colors hover:border-togo-blue hover:text-togo-blue",
              collapsed ? "w-full px-0" : "px-2"
            )}
          >
            {collapsed ? <ChevronRight size={15} className="shrink-0" /> : <ChevronLeft size={15} className="shrink-0" />}
            {!collapsed && "Collapse"}
          </button>

          <button
            onClick={() => setLogoutConfirmOpen(true)}
            title="Log out"
            aria-label="Log out"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border border-togo-border bg-togo-surface/40 py-2 text-xs font-medium text-togo-muted transition-colors hover:border-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)] hover:text-[var(--status-blocked-fg)]",
              collapsed ? "w-full px-0" : "px-2"
            )}
          >
            <LogOut size={15} className="shrink-0" />
            {!collapsed && "Out"}
          </button>
        </div>
      </div>

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
    </aside>
  );
}
