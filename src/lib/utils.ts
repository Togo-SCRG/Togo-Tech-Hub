import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateLong(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function toDateInputValue(date: Date | string) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

// Ordered as work actually moves, since nextStatus() cycles through them.
export const STATUS_OPTIONS = ["Not Started", "In Progress", "Review", "Completed", "On Hold", "Blocked"] as const;
export type StatusType = (typeof STATUS_OPTIONS)[number];

export function nextStatus(status: string): StatusType {
  const idx = STATUS_OPTIONS.indexOf(status as StatusType);
  return STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length];
}

// Saturated status hue for dots and progress bars (matches StatusBadge).
export const STATUS_HEX: Record<string, string> = {
  "Not Started": "#3a6a8a",
  "In Progress": "#0797df",
  // Violet: distinct from the blue of active work and the green of done, so
  // "waiting on someone" reads as its own state at a glance.
  Review: "#a274e8",
  Completed: "#22c97a",
  "On Hold": "#f0a030",
  Blocked: "#e04444",
};

export function statusHex(status: string): string {
  return STATUS_HEX[status] ?? "#0797df";
}

// The app doesn't track a numeric "% complete" per project, so we show a
// status-derived proxy in the progress bars — Completed reads full, Blocked
// low, etc. Real hours-vs-cap is shown separately from this.
const STATUS_PROGRESS: Record<string, number> = {
  "Not Started": 0,
  "In Progress": 60,
  Review: 85,
  Completed: 100,
  "On Hold": 35,
  Blocked: 20,
};

export function statusProgress(status: string): number {
  return STATUS_PROGRESS[status] ?? 0;
}

// Compact "2 min ago" / "3 hr ago" / "2 days ago" from a timestamp.
export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const then = new Date(value).getTime();
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Capitalises every word of a person's name — "alex steurer" and "ALEX STEURER"
 * both become "Alex Steurer". Sentence case is wrong for a name: it produced
 * "Alex steurer", which reads as a typo.
 *
 * Hyphens and apostrophes count as word breaks, so "mary-jane o'brien" comes out
 * as "Mary-Jane O'Brien". Anything already mixed-case in the middle of a word is
 * left alone, which is what preserves "McDonald" and "van der Berg" — those are
 * spellings a general rule can't infer, so the rule doesn't try.
 */
export function toNameCase(text: string) {
  return text.replace(/[^\s\-']+/g, (word) => {
    // A word typed in one case has no intent to preserve, so normalise it. One
    // with capitals inside (McDonald, O'Neill) was spelled deliberately.
    const uniform = word === word.toLowerCase() || word === word.toUpperCase();
    const base = uniform ? word.toLowerCase() : word;
    return base.charAt(0).toUpperCase() + base.slice(1);
  });
}

// Job-title seniority, highest first — director outranks supervisor, and
// everything else sorts alphabetically after both.
const ROLE_RANK_KEYWORDS = ["director", "supervisor"];

function roleRank(role: string): number {
  const lower = role.toLowerCase();
  const idx = ROLE_RANK_KEYWORDS.findIndex((k) => lower.includes(k));
  return idx === -1 ? ROLE_RANK_KEYWORDS.length : idx;
}

export function compareByRole(a: { role: string; name: string }, b: { role: string; name: string }): number {
  const rankDiff = roleRank(a.role) - roleRank(b.role);
  if (rankDiff !== 0) return rankDiff;
  const roleDiff = a.role.localeCompare(b.role);
  if (roleDiff !== 0) return roleDiff;
  return a.name.localeCompare(b.name);
}

// Per-member avatar colors (bg + text), derived from the name so each person
// gets a stable, distinct color like the design mock. Navy-tinted palette.
const AVATAR_PALETTE = [
  { bg: "#0c1f3a", text: "#0797df" },
  { bg: "#0e2030", text: "#22c97a" },
  { bg: "#1a0f2a", text: "#9b6fd4" },
  { bg: "#1a0505", text: "#e04444" },
  { bg: "#1a1005", text: "#f0a030" },
  { bg: "#061220", text: "#0aaaf5" },
  { bg: "#0e2030", text: "#7ab8d9" },
];

export function avatarColor(seed: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Freeform "Phase" tags (e.g. "Setup", "Bug fix") get a consistent color
// derived from their text, rather than needing a maintained fixed list.
const PHASE_PALETTE = [
  { bg: "#1e3a5f", text: "#60a5fa" }, // blue
  { bg: "#450a0a", text: "#f87171" }, // red
  { bg: "#14532d", text: "#4ade80" }, // green
  { bg: "#78350f", text: "#fb923c" }, // orange
  { bg: "#4a1d6e", text: "#c084fc" }, // purple
  { bg: "#134e4a", text: "#2dd4bf" }, // teal
];

export function phaseColor(phase: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < phase.length; i++) {
    hash = (hash << 5) - hash + phase.charCodeAt(i);
    hash |= 0;
  }
  return PHASE_PALETTE[Math.abs(hash) % PHASE_PALETTE.length];
}

// Monday–Sunday range (UTC, matching how dates are stored/formatted
// elsewhere in the app) for the week containing `date`.
export function getWeekRange(date: Date): { from: string; to: string } {
  const day = date.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: toDateInputValue(monday), to: toDateInputValue(sunday) };
}

