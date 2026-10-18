import { Globe, Server } from "lucide-react";

/** How many links a cell shows before summing up the rest. */
const SHOWN = 2;

/**
 * One kind of a row's links — its client portal, or its system links —
 * for that column on the Projects or Proposals list.
 *
 * Each address is cut to the column's width with an ellipsis — "https://
 * sparks-sno…" — so a long one can't stretch the table; the whole address is
 * still the link, and shows on hover.
 */
export function LinkListCell({
  hrefs,
  kind,
  moreHref,
}: {
  hrefs: string[] | undefined;
  kind: "portal" | "system";
  /** Where "+N more" goes — the project's or proposal's own page. */
  moreHref: string;
}) {
  if (!hrefs || hrefs.length === 0) return <span className="text-togo-faint">—</span>;

  const Icon = kind === "portal" ? Globe : Server;
  const label = kind === "portal" ? "Client portal" : "System link";
  const shown = hrefs.slice(0, SHOWN);
  const more = hrefs.length - shown.length;

  return (
    <ul className="space-y-1">
      {shown.map((href) => (
        <li key={href} className="flex min-w-0 items-center gap-1.5">
          <Icon size={12} className="shrink-0 text-togo-faint" aria-hidden />
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`${label}: ${href}`}
            className="block min-w-0 max-w-[160px] truncate text-xs text-togo-blue hover:underline"
          >
            {href}
          </a>
        </li>
      ))}
      {more > 0 && (
        <li>
          <a href={moreHref} className="text-[11px] text-togo-faint hover:text-togo-blue">
            +{more} more
          </a>
        </li>
      )}
    </ul>
  );
}
