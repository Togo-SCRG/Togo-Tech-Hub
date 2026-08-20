import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Shown the instant you click a nav link, for every page in the group.
 *
 * Without this file the App Router has nothing to swap in while it waits for
 * the next page's data, so it leaves the *previous* page on screen — fully
 * drawn and looking interactive — until the whole RSC payload arrives. A slow
 * page therefore read as a frozen one: the click appeared to do nothing.
 *
 * Deliberately generic. It's a shape, not a mock of any one page: a title, a
 * couple of blocks, a table. A per-route loading.tsx can be added underneath
 * this one where the real layout is distinctive enough to be worth matching.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <SkeletonTable rows={6} label="Loading page" />
    </div>
  );
}
