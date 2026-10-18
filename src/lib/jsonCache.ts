/**
 * Last good response per API URL, for the pages that load their data in the
 * browser after they mount (Daily Updates, the Team page's side panels).
 *
 * Without it, every visit to those pages started from nothing — a skeleton and
 * a fresh round of requests — even if you'd left the page seconds earlier. With
 * it, a return visit draws the previous data immediately and the page's own
 * fetch then replaces it with current data: stale-while-revalidate.
 *
 * Cleared wholesale after any save (see RefreshAfterSave), so a page never
 * redraws data you've just changed. Browser-only: the server would share this
 * module between users, so nothing is read or stored there.
 */
const store = new Map<string, unknown>();

/** The last successful response for `url` this session, if there is one. */
export function peekJson<T>(url: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  return store.get(url) as T | undefined;
}

/** `fetch` + `.json()`, remembered for `peekJson`. Null on any failure. */
export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    if (typeof window !== "undefined") store.set(url, data);
    return data;
  } catch {
    return null;
  }
}

export function clearJsonCache() {
  store.clear();
}
