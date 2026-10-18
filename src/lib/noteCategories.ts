import { findLinks } from "@/components/ui/LinkifiedText";
import type { NoteCategory } from "@/types";

/**
 * The kinds of note a project or a proposal can carry (047, 050):
 *
 *   side_note      anything — a call, a decision, what the client said
 *   client_portal  the client's portal
 *   system_link    a system it touches — staging, an admin panel, a repo
 *
 * The last two are what the Projects and Proposals lists show as each row's
 * links, so they must contain one.
 */
export const NOTE_CATEGORIES: {
  value: NoteCategory;
  label: string;
  /** Plural, for the filter. */
  plural: string;
  placeholder: string;
  needsLink: boolean;
}[] = [
  {
    value: "side_note",
    label: "Side note",
    plural: "Side notes",
    placeholder: "A call, a decision, what the client said — paste links and they'll be clickable",
    needsLink: false,
  },
  {
    value: "client_portal",
    label: "Client portal",
    plural: "Client portal",
    placeholder: "The client's portal link — e.g. https://portal.client.com",
    needsLink: true,
  },
  {
    value: "system_link",
    label: "System link",
    plural: "System links",
    placeholder: "A system this touches — staging, admin, repo — with its link",
    needsLink: true,
  },
];

export function isNoteCategory(value: unknown): value is NoteCategory {
  return NOTE_CATEGORIES.some((c) => c.value === value);
}

export function noteCategoryLabel(category: NoteCategory | null | undefined): string {
  return NOTE_CATEGORIES.find((c) => c.value === (category ?? "side_note"))?.label ?? "Side note";
}

/**
 * A note's category, checked along with its text: unknown categories are
 * refused, and a client-portal or system-link note must contain a link. A
 * missing category is a side note.
 */
export function checkNoteCategory(raw: unknown, text: string): { category: NoteCategory } | { error: string } {
  const category = raw === undefined || raw === null || raw === "" ? "side_note" : raw;
  if (!isNoteCategory(category)) return { error: "Unknown note category." };
  const info = NOTE_CATEGORIES.find((c) => c.value === category)!;
  if (info.needsLink && findLinks(text).length === 0) {
    return { error: `A ${info.label.toLowerCase()} note needs the link itself — paste the full address, starting https://.` };
  }
  return { category };
}

/**
 * A piece of text with one link taken out — every occurrence of it — for
 * removing a link from Resources, which removes it where it was written.
 *
 * Only the lines that held it are touched. A line that was just a label and
 * the link ("Staging: https://…") goes entirely — the label only named the
 * link. Otherwise doubled spaces close up, a separator left dangling at the
 * end goes, and a line left with no words (a bare bullet) is dropped. Every
 * other line — blank lines between paragraphs included — stays as it was.
 * Returns "" when nothing worth keeping is left.
 */
export function removeLinkFromText(text: string, href: string): string {
  const lines = text.split("\n").flatMap((line) => {
    // Right to left, so earlier positions stay valid as later ones are cut.
    const hits = findLinks(line).filter((l) => l.href === href).reverse();
    if (hits.length === 0) return [line];
    let out = line;
    for (const hit of hits) out = out.slice(0, hit.start) + out.slice(hit.start + hit.url.length);
    out = out.replace(/[ \t]{2,}/g, " ").trimEnd();
    // "Label:" with nothing after it — the whole line was naming the link.
    if (/^\s*(?:[•*-]\s*)?[^:\n]{1,40}:$/.test(out)) return [];
    out = out.replace(/[\s:–—-]+$/, "").trimEnd();
    return /[\p{L}\p{N}]/u.test(out) ? [out] : [];
  });
  return lines.join("\n").trim();
}

/**
 * Every client-portal and system link in a set of notes, newest first as
 * given, each address once per kind.
 */
export function collectNoteLinks(notes: { category: NoteCategory | null; text: string }[]): {
  portal: string[];
  system: string[];
} {
  const portal: string[] = [];
  const system: string[] = [];
  for (const n of notes) {
    if (n.category !== "client_portal" && n.category !== "system_link") continue;
    const bucket = n.category === "client_portal" ? portal : system;
    for (const link of findLinks(n.text || "")) if (!bucket.includes(link.href)) bucket.push(link.href);
  }
  return { portal, system };
}
