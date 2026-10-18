/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // How long the browser reuses a page it has already loaded or prefetched,
    // in seconds. Next's default for these pages is 30s, so going back to one
    // after half a minute rebuilt it from scratch — several Supabase round
    // trips — and every click felt like a first visit.
    //
    // Your own saves still show straight away: RefreshAfterSave empties this
    // cache after any write. What can lag by up to this long is a teammate's
    // change, until you reload or save something yourself.
    staleTimes: {
      dynamic: 180,
      static: 180,
    },
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.squarespace-cdn.com",
      },
    ],
  },

  async redirects() {
    return [
      // The daily-updates page lived at /tracker until it was renamed. Anyone
      // with a bookmark, or a link in an old email or chat message, would
      // otherwise get a 404. Permanent so browsers and crawlers stop asking.
      //
      // The wildcard carries the query string through, which matters for
      // /tracker?logUpdate=1 — the deep link that opens the log form.
      { source: "/tracker", destination: "/daily-updates", permanent: true },
      { source: "/tracker/:path*", destination: "/daily-updates/:path*", permanent: true },
    ];
  },
};

module.exports = nextConfig;
