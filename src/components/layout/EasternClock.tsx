"use client";

import { useEffect, useState } from "react";

/**
 * The date and time in US Eastern, for the topbar.
 *
 * Rendered client-side and only after mount. The server and the browser sit in
 * different timezones (and, by the time hydration runs, different seconds), so
 * formatting a clock during SSR guarantees a hydration mismatch. Empty first
 * paint is the cost; it lands within a frame.
 *
 * The zone is America/New_York rather than a fixed -05:00 so the offset follows
 * daylight saving. The visible label is just "Mon D · h:mm AM"; the zone (EST in
 * winter, EDT in summer) and the year are in the tooltip, since spelling them
 * out inline crowded the topbar.
 */
export function EasternClock({ className }: { className?: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    function tick() {
      const now = new Date();
      const date = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      });
      const time = now.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      setLabel(`${date} · ${time}`);
      // The zone still matters — the team isn't in Eastern — but printing it
      // inline crowded the topbar, so it moved to the tooltip along with the
      // year. Hovering still answers "EST or EDT, and which year".
      setTitle(
        now.toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "America/New_York",
        }) + " Eastern"
      );
    }

    tick();
    // Every 15s: the display is minute-precision, so this is fine-grained enough
    // that the minute never looks stale, without waking up every second.
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!label) return null;

  return (
    <span className={className} title={title} suppressHydrationWarning>
      {label}
    </span>
  );
}
