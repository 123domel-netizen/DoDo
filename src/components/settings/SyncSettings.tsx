import { useEffect, useState } from "react";
import { forceCloudRefresh, getSyncDiagnosticsSnapshot } from "@/lib/cloud";
import { APP_VERSION, BUILD_LABEL } from "@/lib/version";
import { cloudEnabled } from "@/lib/supabase";
import { syncV3WriterModeLabel } from "@/lib/syncv3/bootstrap";
import { useStore } from "@/state/store";

type Diag = ReturnType<typeof getSyncDiagnosticsSnapshot>;

function DiagRow({ label, value }: { label: string; value: string | number | boolean | null }) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "boolean"
        ? value
          ? "tak"
          : "nie"
        : String(value);
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-ink-faint">{label}</span>
      <span className="max-w-[55%] truncate text-right font-mono text-ink-light">{display}</span>
    </div>
  );
}

/**
 * Ustawienia synchronizacji — bez ręcznego „Wyślij” / pending count / surowych błędów DB.
 * Sync v3 działa automatycznie.
 */
export function SyncSettings() {
  const [diag, setDiag] = useState<Diag>(() => getSyncDiagnosticsSnapshot());
  const [engine, setEngine] = useState<string>("—");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const authUserId = useStore((s) => s.authUserId);

  useEffect(() => {
    const id = window.setInterval(() => setDiag(getSyncDiagnosticsSnapshot()), 1500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void syncV3WriterModeLabel(authUserId).then(setEngine);
  }, [authUserId, diag.lastPushAt, diag.syncReady]);

  if (!cloudEnabled) {
    return (
      <p className="text-xs text-ink-faint">Synchronizacja chmurowa nie jest skonfigurowana.</p>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const result = await forceCloudRefresh();
      setMessage(result.message);
      setDiag(getSyncDiagnosticsSnapshot());
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Synchronizacja
      </div>
      <p className="text-[11px] leading-snug text-ink-faint">
        Zmiany zapisują się lokalnie i wysyłają automatycznie. Nie wymaga ręcznej wysyłki.
      </p>

      <div className="space-y-1 rounded-lg border border-line bg-surface-raised/50 p-2.5">
        <DiagRow label="silnik" value={engine} />
        <DiagRow label="syncReady" value={diag.syncReady} />
        <DiagRow label="online" value={typeof navigator !== "undefined" ? navigator.onLine : null} />
        <DiagRow label="lastPullAt" value={diag.lastPullAt} />
        <DiagRow label="lastPushAt" value={diag.lastPushAt} />
        <DiagRow label="appVersion" value={`${APP_VERSION} (${BUILD_LABEL})`} />
      </div>

      <button
        type="button"
        disabled={refreshing || diag.syncBooting}
        onClick={() => void onRefresh()}
        className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs font-medium text-ink transition hover:border-line-strong disabled:opacity-50"
      >
        {refreshing ? "Odświeżanie…" : "Odśwież widok z chmury"}
      </button>

      {message && (
        <p className="text-center text-xs text-accent-soft" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
