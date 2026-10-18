"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearViewAs } from "@/lib/viewAs";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // A "View as" preview left behind on this browser would make the app
    // read-only for whoever just signed in.
    await clearViewAs();

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-togo-black flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          {/* Dark variant recolours the wolf to white and leaves TOGO blue. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/togo.webp" alt="Togo" className="h-14 w-auto object-contain dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/togo-dark.webp" alt="Togo" className="hidden h-14 w-auto object-contain dark:block" />
        </div>

        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface shadow-[var(--shadow-modal)]">
          <div className="h-1 bg-togo-blue" />
          <div className="p-8">
            <h1 className="text-xl font-bold text-togo-white mb-1">Welcome back</h1>
            <p className="text-sm text-togo-muted mb-6">Sign in to the Togo Tech Hub.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="login-email" required>
                  Email
                </Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. padwa@togo.dev"
                  autoComplete="email"
                  aria-invalid={!!error}
                  autoFocus
                  required
                />
              </div>
              <div>
                <Label htmlFor="login-password" required>
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    aria-invalid={!!error}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-togo-faint transition-colors hover:text-togo-muted"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-3 py-2"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-[var(--status-blocked-fg)]" />
                  <p className="text-sm text-[var(--status-blocked-fg)]">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-togo-faint mt-6">Internal tool — Togo Tech Team</p>
      </div>
    </div>
  );
}
