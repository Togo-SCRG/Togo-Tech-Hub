import type { ReactNode } from "react";

// http(s) links, plus bare "www." ones since that's how people paste them into
// a note. Nothing else is turned into a link — in particular no other scheme,
// so a pasted "javascript:" string stays inert text.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

const SENTENCE_PUNCTUATION = ".,;:!?'\"";

/**
 * Splits trailing punctuation off a matched URL: "see https://x.com/a." links
 * to /a, not "/a.". A closing bracket is only dropped when the URL didn't open
 * one itself, so "(https://x.com)" loses it but a wiki-style "/Foo_(bar)"
 * keeps it.
 */
function splitTrailing(raw: string): [url: string, rest: string] {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (SENTENCE_PUNCTUATION.includes(ch)) {
      end--;
      continue;
    }
    if (ch === ")" || ch === "]") {
      const body = raw.slice(0, end);
      const opener = ch === ")" ? "(" : "[";
      if (body.split(opener).length < body.split(ch).length) {
        end--;
        continue;
      }
    }
    break;
  }
  return [raw.slice(0, end), raw.slice(end)];
}

function toHref(url: string): string | null {
  const candidate = /^www\./i.test(url) ? `https://${url}` : url;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

interface FoundLink {
  /** Where the match starts in the text. */
  start: number;
  /** The whole match, trailing punctuation included — what `start` measures to. */
  raw: string;
  /** The address as written, minus trailing punctuation. */
  url: string;
  /** Normalised and safe to put in an href (http/https only). */
  href: string;
  /** Punctuation that followed the address — text, not part of the link. */
  rest: string;
}

/**
 * Every web address in a piece of text, by the same rules the rendered links
 * use — so a list that pulls links out of notes finds exactly the ones the
 * notes show as clickable.
 */
export function findLinks(text: string): FoundLink[] {
  const links: FoundLink[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const [url, rest] = splitTrailing(match[0]);
    const href = toHref(url);
    if (href) links.push({ start: match.index ?? 0, raw: match[0], url, href, rest });
  }
  return links;
}

/**
 * Plain text with any web addresses in it made clickable. Opens links in a new
 * tab, since they're almost always to somewhere outside the app (a staging
 * site, a doc, a ticket) and leaving the page would lose your place.
 *
 * Renders inline — put it inside whatever element sets the text's style and
 * wrapping. Long addresses break anywhere rather than pushing the layout wider.
 */
export function LinkifiedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const { start, raw, url, href, rest } of findLinks(text)) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-togo-blue underline underline-offset-2 transition-opacity [overflow-wrap:anywhere] hover:opacity-80"
      >
        {url}
      </a>
    );
    if (rest) parts.push(rest);
    cursor = start + raw.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
