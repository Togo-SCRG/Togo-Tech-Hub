import type { SupabaseClient } from "@supabase/supabase-js";
import { findLinks } from "@/components/ui/LinkifiedText";
import { isNoteCategory, noteCategoryLabel } from "@/lib/noteCategories";
import type { HubFile, ResourceLink, ResourceLinkCategory, SourcedLink } from "@/types";

/**
 * Resources (migration 049): the team's shared library of links and files.
 * Free of server-only imports — the client components use the categories and
 * the storage path, the server pages the fetchers.
 */

export const RESOURCE_FILES_BUCKET = "resource-files";

export const MIGRATION_049_MISSING = "Resources need a database update — run migration 049 in the Supabase SQL Editor.";

export const LINK_CATEGORIES: { value: ResourceLinkCategory; label: string; hint: string }[] = [
  { value: "company", label: "Company", hint: "Togo's own sites and pages" },
  { value: "tool", label: "Tools", hint: "Apps the team works in" },
  { value: "system", label: "Systems", hint: "Staging, admin panels, dashboards, repos" },
  { value: "docs", label: "Documentation", hint: "Guides, specs, handbooks" },
  { value: "client", label: "Clients", hint: "Client sites and portals" },
  { value: "other", label: "Other", hint: "Anything else worth keeping" },
];

export function isLinkCategory(value: unknown): value is ResourceLinkCategory {
  return LINK_CATEGORIES.some((c) => c.value === value);
}

export function linkCategoryLabel(category: ResourceLinkCategory): string {
  return LINK_CATEGORIES.find((c) => c.value === category)?.label ?? "Other";
}

/** "https://www.example.com/a/" → "example.com/a" — how an address reads as a caption. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** 42P01 / PGRST205: the table isn't there (049 not run). */
export function isResourcesMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (["42P01", "PGRST205"].includes(error.code || "")) return true;
  return /resource_/i.test(error.message || "") && /does not exist|could not find/i.test(error.message || "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const RESOURCE_LINK_SELECT =
  "id, label, url, category, description, is_official, pinned, created_at, profiles(id, name)";

export function toResourceLink(row: Row): ResourceLink {
  const author = row.profiles as { id?: string; name?: string } | null;
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    category: isLinkCategory(row.category) ? row.category : "other",
    description: row.description ?? null,
    isOfficial: !!row.is_official,
    pinned: !!row.pinned,
    createdBy: author?.id && author.name ? { id: author.id, name: author.name } : null,
    createdAt: row.created_at,
  };
}

/** A link form's fields, checked and mapped to columns. `partial` for an edit. */
export function parseLinkFields(
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  const has = (key: string) => body[key] !== undefined;
  const text = (key: string) => (typeof body[key] === "string" && (body[key] as string).trim() ? (body[key] as string).trim() : null);

  if (has("label") || !partial) {
    const label = text("label");
    if (!label) return { error: "Give the link a label — what it is, e.g. “Staging site”." };
    fields.label = label.slice(0, 120);
  }
  if (has("url") || !partial) {
    const raw = text("url");
    // The same rules that make links clickable elsewhere: http(s) only, and a
    // bare "www." address gets https:// in front.
    const found = raw ? findLinks(raw) : [];
    if (!raw || found.length !== 1 || found[0].start !== 0 || found[0].url.length < raw.length - found[0].rest.length) {
      return { error: "That doesn't look like a web address — paste the whole thing, e.g. https://example.com." };
    }
    fields.url = found[0].href;
  }
  if (has("category")) {
    if (!isLinkCategory(body.category)) return { error: "Unknown category." };
    fields.category = body.category;
  }
  if (has("description")) fields.description = text("description")?.slice(0, 300) ?? null;
  if (has("pinned")) fields.pinned = !!body.pinned;
  if (has("isOfficial")) fields.is_official = !!body.isOfficial;
  return { fields };
}

export async function fetchResourceLinks(supabase: SupabaseClient): Promise<{ ready: boolean; links: ResourceLink[] }> {
  const { data, error } = await supabase
    .from("resource_links")
    .select(RESOURCE_LINK_SELECT)
    .order("is_official", { ascending: false })
    .order("pinned", { ascending: false })
    .order("label");
  if (error) {
    if (!isResourcesMissing(error)) console.error(`[resources] links failed: ${error.code} ${error.message}`);
    return { ready: !isResourcesMissing(error), links: [] };
  }
  return { ready: true, links: (data || []).map(toResourceLink) };
}

/** How a gathered link is labelled: "Sparks Snow — Client portal". */
export function sourcedLinkKindLabel(link: Pick<SourcedLink, "kind" | "source">): string {
  if (link.kind === "overview") return link.source === "project" ? "Overview" : "Summary";
  return noteCategoryLabel(link.kind);
}

/**
 * Every link written anywhere in the hub's projects and proposals — in their
 * notes, whatever the category, and in a project's overview or a proposal's
 * summary — each labelled with where it came from, for Resources › Links.
 *
 * Proposals only for people with proposal access: their policies (045) return
 * nothing to anyone else, so including them is safe either way, but skipped
 * when there's no point. Any source that isn't set up yet (a migration not
 * run) is simply left out.
 */
export async function fetchSourcedLinks(
  supabase: SupabaseClient,
  { includeProposals }: { includeProposals: boolean }
): Promise<SourcedLink[]> {
  const projectNotes = async (): Promise<Row[]> => {
    const withCategory = await supabase
      .from("project_side_notes")
      .select("id, project, category, body")
      .order("created_at", { ascending: false });
    // Before 050 there's no category: every project note is a side note.
    if (withCategory.error) {
      const plain = await supabase.from("project_side_notes").select("id, project, body").order("created_at", { ascending: false });
      return ((plain.data || []) as Row[]).map((r): Row => ({ ...r, category: "side_note" }));
    }
    return (withCategory.data || []) as Row[];
  };

  const [notes, overviews, proposalNotes, summaries] = await Promise.all([
    projectNotes(),
    supabase.from("project_settings").select("project, overview").not("overview", "is", null),
    includeProposals
      ? supabase
          .from("proposal_activity")
          .select("id, proposal_id, note_category, detail, proposals(title)")
          .eq("kind", "note")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    includeProposals
      ? supabase.from("proposals").select("id, title, summary").not("summary", "is", null)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const seen = new Set<string>();
  const links: SourcedLink[] = [];
  const add = (text: string, entry: Omit<SourcedLink, "href">) => {
    for (const { href } of findLinks(text || "")) {
      // One row per address per kind per project/proposal. Removing it (see
      // /api/resources/remove-link) clears it from every such note, so a link
      // written twice doesn't need deleting twice.
      const key = `${entry.source}|${entry.sourceKey}|${entry.kind}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ ...entry, href });
    }
  };

  for (const n of notes) {
    add(n.body, {
      kind: isNoteCategory(n.category) ? n.category : "side_note",
      source: "project",
      sourceName: n.project,
      sourceHref: `/projects/${encodeURIComponent(n.project)}`,
      sourceKey: n.project,
      noteId: n.id,
    });
  }
  for (const o of (overviews.data || []) as Row[]) {
    add(o.overview, {
      kind: "overview",
      source: "project",
      sourceName: o.project,
      sourceHref: `/projects/${encodeURIComponent(o.project)}`,
      sourceKey: o.project,
      noteId: null,
    });
  }
  for (const n of (proposalNotes.data || []) as Row[]) {
    const title = (n.proposals as { title?: string } | null)?.title || "Untitled proposal";
    add(n.detail, {
      kind: isNoteCategory(n.note_category) ? n.note_category : "side_note",
      source: "proposal",
      sourceName: title,
      sourceHref: `/proposals/${n.proposal_id}`,
      sourceKey: n.proposal_id,
      noteId: n.id,
    });
  }
  for (const s of (summaries.data || []) as Row[]) {
    add(s.summary, {
      kind: "overview",
      source: "proposal",
      sourceName: s.title,
      sourceHref: `/proposals/${s.id}`,
      sourceKey: s.id,
      noteId: null,
    });
  }
  return links;
}

/**
 * Every file in the hub the viewer can see: the library's own, every
 * project's documents, and — for people with proposal access — every
 * proposal's. Each keeps its own table and permissions; this only lists them
 * together. Sources that aren't set up yet (a migration not run) are skipped.
 */
export async function fetchHubFiles(
  supabase: SupabaseClient,
  { includeProposals }: { includeProposals: boolean }
): Promise<{ ready: boolean; files: HubFile[] }> {
  const LIMIT = 500;
  const [library, projects, proposals] = await Promise.all([
    supabase
      .from("resource_files")
      .select("id, name, size_bytes, created_at, uploaded_by, profiles(name)")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("project_documents")
      .select("id, name, size_bytes, created_at, project, profiles(name)")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    includeProposals
      ? supabase
          .from("proposal_documents")
          .select("id, name, size_bytes, created_at, proposal_id, profiles(name), proposals(title)")
          .order("created_at", { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);

  const uploader = (row: Row) => (row.profiles as { name?: string } | null)?.name ?? null;
  const files: HubFile[] = [
    ...((library.data || []) as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size_bytes ?? null,
      uploadedAt: r.created_at,
      uploadedBy: uploader(r),
      uploadedById: r.uploaded_by ?? null,
      source: "library" as const,
      sourceName: null,
      sourceHref: null,
      endpoint: `/api/resource-files/${r.id}`,
    })),
    ...((projects.data || []) as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size_bytes ?? null,
      uploadedAt: r.created_at,
      uploadedBy: uploader(r),
      uploadedById: null,
      source: "project" as const,
      sourceName: r.project as string,
      sourceHref: `/projects/${encodeURIComponent(r.project)}`,
      endpoint: `/api/project-documents/${r.id}`,
    })),
    ...((proposals.data || []) as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size_bytes ?? null,
      uploadedAt: r.created_at,
      uploadedBy: uploader(r),
      uploadedById: null,
      source: "proposal" as const,
      sourceName: (r.proposals as { title?: string } | null)?.title ?? "Proposal",
      sourceHref: `/proposals/${r.proposal_id}`,
      endpoint: `/api/proposal-documents/${r.id}`,
    })),
  ].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return { ready: !isResourcesMissing(library.error), files };
}

/** Storage key for a library file: a collision-proof, sanitised name. */
export function libraryStoragePath(fileName: string): string {
  const safeName = fileName.normalize("NFKD").replace(/[^\w.\-() ]+/g, "_").slice(-120) || "file";
  const tag = Math.random().toString(36).slice(2, 10);
  return `library/${Date.now()}-${tag}-${safeName}`;
}
