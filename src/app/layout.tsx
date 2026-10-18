import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Togo Tech Hub",
  description: "Internal team productivity dashboard for the Togo tech team.",
  icons: {
    icon: [{ url: "/logo/togo.webp", type: "image/webp" }],
    shortcut: [{ url: "/logo/togo.webp", type: "image/webp" }],
  },
};

// Default zoom/scale = 100% (width=device-width, initial-scale=1) —
// explicit rather than relying on the browser's implicit default.
//
// colorScheme emits <meta name="color-scheme">, which the browser honours while
// parsing — before globals.css has loaded. Without it a cold load paints the
// default white canvas until the stylesheet arrives, which is why the site
// flashed light on a first visit and looked correct on reload (CSS cached).
// Light first, so that's the canvas we get; the `dark` fallback covers the
// scrollbars and form controls of anyone who has chosen dark.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

// Light is the default: <html> carries no `dark` class in the markup below, so a
// first paint (or a session with JavaScript blocked, or a script that fails) is
// light.
//
// All this script does is *add* the class for someone who has chosen dark. It
// runs before hydration, so that choice is applied on the first paint instead
// of flashing light and snapping to dark a moment later.
const themeInitScript = `
(function () {
  try {
    if (localStorage.getItem("togo-theme") === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {
    // localStorage can throw in private mode. Light is already applied, which is
    // the default anyway, so there's nothing to recover from.
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because the script above may have added the
    // `dark` class before React hydrates, which would otherwise be reported as a
    // server/client mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-togo-black text-togo-white min-h-screen antialiased" suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
