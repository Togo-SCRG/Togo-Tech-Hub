"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * A Link that starts loading its whole page the moment you show intent —
 * pointer over it, keyboard focus on it, or a finger down on it.
 *
 * A plain Link to a server-rendered page only prefetches the loading skeleton,
 * so the click still waits for the page's data. Prefetching every row's full
 * page up front (prefetch={true}) would render each project or member page in
 * a list just because it scrolled into view. Waiting for intent costs nothing
 * for rows nobody points at, and gives the ones people do open a head start of
 * the hover-to-click gap — usually most of the wait.
 *
 * router.prefetch defaults to a full prefetch and is a no-op while a fresh one
 * is already cached, so repeated hovers don't refetch. Production only — Next
 * doesn't prefetch in development.
 */
export function IntentLink({ href, onMouseEnter, onFocus, onTouchStart, ...props }: Props) {
  const router = useRouter();
  const warm = () => router.prefetch(href);

  return (
    <Link
      href={href}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        warm();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        warm();
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        warm();
      }}
      {...props}
    />
  );
}
