"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K | null;
  direction: SortDirection;
}

/**
 * Click-to-sort for the app's tables. `accessors` maps a column key to the
 * comparable value for a row; strings compare case-insensitively and
 * null/undefined always sort last regardless of direction, so empty cells
 * don't crowd the top of a descending sort.
 */
export function useSort<T, K extends string>(
  items: T[],
  accessors: Record<K, (item: T) => string | number | null | undefined>,
  initial: SortState<K> = { key: null, direction: "asc" }
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  function toggle(key: K) {
    setSort((prev) =>
      prev.key === key
        ? prev.direction === "asc"
          ? { key, direction: "desc" }
          : { key: null, direction: "asc" } // third click clears back to natural order
        : { key, direction: "asc" }
    );
  }

  /** Drop any column sort, back to the items' natural order. */
  function clear() {
    setSort({ key: null, direction: "asc" });
  }

  const sorted = useMemo(() => {
    if (!sort.key) return items;
    const accessor = accessors[sort.key];
    if (!accessor) return items;
    const factor = sort.direction === "asc" ? 1 : -1;

    return [...items].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * factor;
    });
    // `accessors` is rebuilt each render by callers; sorting only depends on
    // the items and the chosen key/direction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort.key, sort.direction]);

  return { sorted, sort, toggle, clear };
}
