"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearJsonCache } from "@/lib/jsonCache";

// Writes that don't change anything another page shows, fired in the background
// when a page opens. Refreshing after them would throw the page cache away on
// every visit to those pages and undo the point of keeping one.
const BACKGROUND_WRITES = new Set(["/api/projects/overdue-check", "/api/notifications/seen"]);

function requestUrl(input: RequestInfo | URL): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, window.location.origin);
}

/**
 * Keeps cached pages honest after a save.
 *
 * Visited and prefetched pages are reused for a few minutes (staleTimes in
 * next.config.js), which is what makes clicking back to a page instant. The
 * cost is that a page cached before you changed something would still show the
 * old value — and most saves here are plain fetches to /api that update local
 * state rather than calling router.refresh().
 *
 * So instead of relying on every one of those call sites, this watches for any
 * successful write to the app's own API and refreshes once: router.refresh()
 * re-renders the current page and empties the page cache, and the browser-side
 * JSON cache is cleared with it. Debounced so a bulk action that fires one
 * request per row still causes a single refresh.
 */
export function RefreshAfterSave() {
  const router = useRouter();

  useEffect(() => {
    const originalFetch = window.fetch;
    let timer: ReturnType<typeof setTimeout> | undefined;

    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method !== "GET" && method !== "HEAD" && response.ok) {
          const url = requestUrl(input);
          if (
            url.origin === window.location.origin &&
            url.pathname.startsWith("/api/") &&
            !BACKGROUND_WRITES.has(url.pathname)
          ) {
            clearJsonCache();
            clearTimeout(timer);
            timer = setTimeout(() => router.refresh(), 50);
          }
        }
      } catch {
        // Bookkeeping only — never let it break the request it's watching.
      }
      return response;
    };

    return () => {
      clearTimeout(timer);
      window.fetch = originalFetch;
    };
  }, [router]);

  return null;
}
