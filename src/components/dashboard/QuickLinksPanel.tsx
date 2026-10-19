import Link from "next/link";
import { ArrowRight, ExternalLink, Globe, Plus } from "lucide-react";
import { LINK_CATEGORY_ICON } from "@/components/resources/linkIcons";
import { displayUrl } from "@/lib/resources";
import type { ResourceLink } from "@/types";

/**
 * The dashboard's Quick links: Togo's official website first, then whatever
 * has been pinned in Resources. Everyone — clients included — sees them, and
 * anyone may set the official website or pin a link (051).
 */
export function QuickLinksPanel({ official, pinned }: { official: ResourceLink | null; pinned: ResourceLink[] }) {
  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center justify-between border-b border-togo-border px-4 py-2.5">
        <span className="text-xs font-medium text-togo-muted">Quick links</span>
        <Link
          href="/resources?tab=links"
          className="flex items-center gap-1 text-[11px] text-togo-faint transition-colors hover:text-togo-blue"
        >
          All resources <ArrowRight size={11} />
        </Link>
      </div>

      {official ? (
        <a
          href={official.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 border-b border-togo-border bg-togo-blue/[0.06] px-4 py-3 transition-colors hover:bg-togo-blue/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-togo-blue text-white">
            <Globe size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-togo-blue">Official website</span>
            <span className="block truncate text-sm font-bold text-togo-white group-hover:text-togo-blue">{official.label}</span>
            <span className="block truncate text-xs text-togo-muted">{displayUrl(official.url)}</span>
          </span>
          <ExternalLink size={14} className="shrink-0 text-togo-faint group-hover:text-togo-blue" />
        </a>
      ) : (
        <Link
          href="/resources?tab=links"
          className="flex items-center gap-3 border-b border-togo-border px-4 py-3 text-sm transition-colors hover:bg-[var(--togo-hover)]"
        >
          <Plus size={16} className="shrink-0 text-togo-faint" />
          <span className="min-w-0">
            <span className="block font-semibold text-togo-white">Add Togo&apos;s official website</span>
            <span className="block text-xs text-togo-faint">It&apos;ll be featured here for everyone.</span>
          </span>
        </Link>
      )}

      {pinned.length > 0 ? (
        <ul className="divide-y divide-togo-border">
          {pinned.map((l) => {
            const Icon = LINK_CATEGORY_ICON[l.category];
            return (
              <li key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.url}
                  className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--togo-hover)]"
                >
                  <Icon size={15} className="shrink-0 text-togo-faint group-hover:text-togo-blue" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-togo-white group-hover:text-togo-blue">{l.label}</span>
                    <span className="block truncate text-[11px] text-togo-faint">{displayUrl(l.url)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-togo-faint">
          Pin links in <Link href="/resources?tab=links" className="text-togo-blue hover:underline">Resources</Link> to keep them here.
        </p>
      )}
    </section>
  );
}
