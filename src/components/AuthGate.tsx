import { useEffect, useState, type ReactNode } from "react";
import { cloudEnabled, supabase } from "@/lib/supabase";
import {
  clearAuthErrorFromUrl,
  parseAuthErrorFromUrl,
  signInWithGoogle,
} from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";

/**
 * Gdy Supabase jest skonfigurowany, wymagane jest logowanie Google (whitelist).
 * Bez Supabase aplikacja działa lokalnie (IndexedDB).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!cloudEnabled);
  const [signedIn, setSignedIn] = useState(false);
  const [err, setErr] = useState<string | null>(() => parseAuthErrorFromUrl());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cloudEnabled || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
      if (session) {
        setErr(null);
        clearAuthErrorFromUrl();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!cloudEnabled) return <>{children}</>;
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">Łączenie…</div>
    );
  }
  if (signedIn) return <>{children}</>;

  const login = async () => {
    setErr(null);
    clearAuthErrorFromUrl();
    setLoading(true);
    const { error } = await signInWithGoogle();
    if (error) setErr(error);
    setLoading(false);
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-overlay p-6 shadow-pop">
        <Logo size={52} className="mb-5" />
        <h1 className="mb-1 text-lg font-semibold text-ink">Zaloguj się</h1>
        <p className="mb-4 text-sm text-ink-light">
          Użyj konta Google zaproszonego do aplikacji. Każdy użytkownik ma własny kalendarz i
          listę zadań.
        </p>
        {err && <p className="mb-3 text-xs text-red-400">{err}</p>}
        <button
          type="button"
          onClick={() => void login()}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-sm font-semibold text-ink transition hover:border-line-strong disabled:opacity-50"
        >
          <GoogleIcon />
          {loading ? "Przekierowanie…" : "Zaloguj przez Google"}
        </button>
        <p className="mt-3 text-[11px] leading-snug text-ink-faint">
          Brak konta na liście zaproszeń? Poproś administratora o dodanie Twojego adresu Gmail.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.083 36 24 36c-5.523 0-10-4.477-10-10s4.477-10 10-10c2.475 0 4.735.86 6.505 2.287l6.011-6.011C34.746 9.053 29.544 6 24 6 12.955 6 4 14.955 4 26s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.651-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 12 24 12c2.475 0 4.735.86 6.505 2.287l6.011-6.011C34.746 9.053 29.544 6 24 6 16.318 6 9.656 10.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 46c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 36.091 26.715 37 24 37c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 41.556 16.227 46 24 46z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.219 8-11.303 8-5.523 0-10-4.477-10-10s4.477-10 10-10c2.475 0 4.735.86 6.505 2.287l6.011-6.011C34.746 9.053 29.544 6 24 6 12.955 6 4 14.955 4 26s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.651-.389-3.917z"
      />
    </svg>
  );
}
