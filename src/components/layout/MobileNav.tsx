"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearViewAs } from "@/lib/viewAs";
import { cn } from "@/lib/utils";
import { getNavItems } from "./Sidebar";
import { TogoLogo } from "./TogoLogo";

// Sidebar is desktop-only (`hidden md:flex`), so phones/tablets otherwise
// have no way to navigate between pages. This mounts a hamburger trigger
// + slide-in drawer in the Topbar, visible only below the md breakpoint.
export function MobileNav({
  isAdmin,
  isSuperAdmin = false,
  isClient = false,
  canSeeProposals = false,
}: {
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  isClient?: boolean;
  canSeeProposals?: boolean;
}) {
  const NAV_ITEMS = getNavItems(isAdmin, isSuperAdmin, isClient, canSeeProposals);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Escape closes the drawer, and the page behind it stays put while it's up.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function handleLogout() {
    const supabase = createClient();
    // While the session still exists — the route that clears it needs one.
    await clearViewAs();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-togo-border bg-togo-surface p-2 text-togo-muted hover:text-togo-blue hover:border-togo-blue transition-colors"
        title="Open menu"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {open &&
        mounted &&
        createPortal(
          // Rendered at the document root on purpose. This lives inside the
          // Topbar, which uses `backdrop-blur` — and an element with
          // backdrop-filter becomes the containing block for its fixed-position
          // descendants. Left in place, `fixed inset-0` resolved against the
          // ~56px header box instead of the viewport, so the drawer was
          // squashed into the header and the page showed through it.
          <div data-modal-open className="fixed inset-0 z-50">
          <div className="animate-fade-in fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="animate-drawer-in fixed inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r border-togo-border bg-togo-charcoal"
          >
            <div className="flex items-center justify-between border-b border-togo-border px-4 py-4">
              <TogoLogo compact={false} />
              <button
                onClick={() => setOpen(false)}
                className="text-togo-muted hover:text-togo-white transition-colors"
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-4">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    // Same full prefetch as the desktop sidebar.
                    prefetch={true}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 border-l-4 px-6 py-3 text-sm font-medium transition-colors",
                      active
                        ? "border-togo-blue bg-togo-surface/50 text-togo-blue"
                        : "border-transparent text-togo-muted hover:bg-togo-surface/30 hover:text-togo-white"
                    )}
                  >
                    <Icon size={18} className="shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-togo-border p-2">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-togo-muted transition-colors hover:bg-[var(--status-blocked-bg)] hover:text-[var(--status-blocked-fg)]"
              >
                <LogOut size={18} />
                Log Out
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}
    </div>
  );
}
