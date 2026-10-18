import type { SupabaseClient } from "@supabase/supabase-js";
import { collectNoteLinks, isNoteCategory } from "@/lib/noteCategories";
import type { NoteCategory, ProjectDocument, ProjectSideNote, ProposalLinks } from "@/types";

/**
 * A project's documents and side notes (migration 044).
 *
 * The fetchers run on the server; the storage-path helper and limits are also
 * used by the browser, which uploads files to Storage directly. Each fetcher
 * reports `ready: false` rather than throwing when its table isn't there yet —
 * migrations here are run by hand, and a project page that 500s until someone
 * does is a far worse failure than a Documents tab saying the database needs
 * updating.
 */

export const DOCUMENTS_BUCKET = "project-files";

/** Per file. Uploads go browser → Storage directly, so this isn't capped by the host's request size. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const MIGRATION_044_MISSING = "Documents and notes aren't set up yet — run migration 044 in Supabase.";
export const MIGRATION_050_MISSING =
  "Client portal and system link notes need a database update — run migration 050 in Supabase.";

export const DOCUMENT_SELECT = "id, name, size_bytes, content_type, created_at, profiles(name)";
export const NOTE_SELECT = "id, body, category, created_at, updated_at, profiles(name, avatar_url)";
/** Before 050: no category, so every note reads as a side note. */
export const NOTE_SELECT_PRE_050 = "id, body, created_at, updated_at, profiles(name, avatar_url)";

/** 42703 / PGRST204: a column a later migration adds isn't there yet. */
export function isMissingColumn(error: { code?: string } | null | undefined) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/**
 * 42P01 from Postgres, PGRST205 from PostgREST's schema cache: the table isn't
 * there. The message fallback also requires "does not exist" / "could not find
 * the table", because other errors name the table too — an RLS denial says
 * 'violates row-level security policy for table "project_documents"', and
 * reading that as "run the migration" would send people the wrong way.
 */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined, table: string) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message || "";
  return message.includes(table) && /does not exist|could not find the table/i.test(message);
}

// Rows arrive untyped (no generated schema), so they're read field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function toProjectDocument(row: Row): ProjectDocument {
  const uploader = row.profiles as { name?: string } | null;
  return {
    id: row.id,
    name: row.name,
    size: row.size_bytes ?? null,
    contentType: row.content_type ?? null,
    uploadedAt: row.created_at,
    uploadedBy: uploader?.name ?? null,
  };
}

export function toProjectSideNote(row: Row): ProjectSideNote {
  const author = row.profiles as { name?: string; avatar_url?: string | null } | null;
  return {
    id: row.id,
    body: row.body,
    category: isNoteCategory(row.category) ? row.category : "side_note",
    author: author?.name ? { name: author.name, avatarUrl: author.avatar_url ?? null } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export async function fetchProjectDocuments(
  supabase: SupabaseClient,
  project: string
): Promise<{ ready: boolean; documents: ProjectDocument[] }> {
  const { data, error } = await supabase
    .from("project_documents")
    .select(DOCUMENT_SELECT)
    .eq("project", project)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingTable(error, "project_documents")) {
      console.error(`[project-documents] query failed: ${error.code} ${error.message}`);
    }
    return { ready: !isMissingTable(error, "project_documents"), documents: [] };
  }
  return { ready: true, documents: (data || []).map(toProjectDocument) };
}

export async function fetchProjectSideNotes(
  supabase: SupabaseClient,
  project: string
): Promise<{ ready: boolean; notes: ProjectSideNote[] }> {
  const query = (select: string) =>
    supabase.from("project_side_notes").select(select).eq("project", project).order("created_at", { ascending: false });
  let { data, error } = await query(NOTE_SELECT);
  // Before 050 the category column isn't there and the select fails outright —
  // retry without it rather than hide every note.
  if (error && isMissingColumn(error)) ({ data, error } = await query(NOTE_SELECT_PRE_050));
  if (error) {
    if (!isMissingTable(error, "project_side_notes")) {
      console.error(`[project-side-notes] query failed: ${error.code} ${error.message}`);
    }
    return { ready: !isMissingTable(error, "project_side_notes"), notes: [] };
  }
  return { ready: true, notes: ((data || []) as unknown as Row[]).map(toProjectSideNote) };
}

/**
 * Every project's client-portal and system links, keyed by project, for the
 * Projects list — pulled out of its link notes. Empty (rather than failing)
 * before 044 or 050.
 */
export async function fetchProjectLinks(supabase: SupabaseClient): Promise<Record<string, ProposalLinks>> {
  const { data, error } = await supabase
    .from("project_side_notes")
    .select("project, category, body")
    .in("category", ["client_portal", "system_link"])
    .order("created_at", { ascending: false });
  if (error) return {};

  const grouped = new Map<string, { category: NoteCategory; text: string }[]>();
  for (const row of data || []) {
    const list = grouped.get(row.project as string) ?? [];
    list.push({ category: row.category as NoteCategory, text: (row.body as string) || "" });
    grouped.set(row.project as string, list);
  }
  return Object.fromEntries([...grouped].map(([project, notes]) => [project, collectNoteLinks(notes)]));
}

/**
 * Documents and notes hang off project_settings(project) by foreign key — that's
 * what carries them through a rename. A project that so far only exists through
 * logged work has no settings row, so make one. DO NOTHING on conflict, so an
 * existing row (and its status, timeline and cap) is never touched.
 */
export async function ensureProjectSettingsRow(supabase: SupabaseClient, project: string) {
  return supabase.from("project_settings").upsert({ project }, { onConflict: "project", ignoreDuplicates: true });
}

/**
 * Where an upload lives in Storage: under the project's folder (the layout the
 * bucket's policies already expect from PRD uploads), with a timestamp and a
 * random tag so two files with the same name — even in one batch — never
 * collide, and a name reduced to characters every storage backend accepts.
 * The original name is kept in the database for display.
 */
export function documentStoragePath(project: string, fileName: string): string {
  const safeName = fileName.normalize("NFKD").replace(/[^\w.\-() ]+/g, "_").slice(-120) || "file";
  const tag = Math.random().toString(36).slice(2, 10);
  return `${project}/${Date.now()}-${tag}-${safeName}`;
}
