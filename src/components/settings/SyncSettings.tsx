import { useEffect, useState } from "react";
import { forceCloudRefresh, getSyncDiagnosticsSnapshot } from "@/lib/cloud";
import { APP_VERSION, BUILD_LABEL } from "@/lib/version";
import { cloudEnabled } from "@/lib/supabase";

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

export function SyncSettings() {
  const [diag, setDiag] = useState<Diag>(() => getSyncDiagnosticsSnapshot());
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setDiag(getSyncDiagnosticsSnapshot()), 1500);
    return () => window.clearInterval(id);
  }, []);

  if (!cloudEnabled) {
    return (
      <p className="text-xs text-ink-faint">Synchronizacja chmurowa nie jest skonfigurowana.</p>
    );
  }

  const onRefresh = async () => {
    const current = getSyncDiagnosticsSnapshot();
    const pending =
      current.dirtyItemsCount +
      current.dirtyParticipantCount +
      (current.tagAssignmentsDirty ? 1 : 0);
    if (pending > 0) {
      const ok = window.confirm(
        `Masz ${current.dirtyItemsCount} niezsynchronizowanych zmian lokalnych` +
          (current.dirtyParticipantCount
            ? ` (+ ${current.dirtyParticipantCount} SHARE)`
            : "") +
          (current.tagAssignmentsDirty ? " oraz niezapisane tagi" : "") +
          ". Odświeżenie z chmury je porzuci. Kontynuować?",
      );
      if (!ok) return;
    }

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
        Supabase jest źródłem prawdy. Lokalna baza to cache. Push wysyła tylko zmienione
        rekordy po zakończeniu initial pull.
      </p>

      <div className="space-y-1 rounded-lg border border-line bg-surface-raised/50 p-2.5">
        <DiagRow label="syncReady" value={diag.syncReady} />
        <DiagRow label="syncBooting" value={diag.syncBooting} />
        <DiagRow label="applyingRemote" value={diag.applyingRemote} />
        <DiagRow label="pushBlocked" value={diag.pushBlocked} />
        <DiagRow label="lastPullAt" value={diag.lastPullAt} />
        <DiagRow label="lastAutoPullAt" value={diag.lastAutoPullAt} />
        <DiagRow label="autoPullEnabled" value={diag.autoPullEnabled} />
        <DiagRow label="lastPushAt" value={diag.lastPushAt} />
        <DiagRow label="localItemsCount" value={diag.localItemsCount} />
        <DiagRow label="visibleItemsCount" value={diag.visibleItemsCount} />
        <DiagRow label="deletedItemsCount" value={diag.deletedItemsCount} />
        <DiagRow label="dirtyItemsCount" value={diag.dirtyItemsCount} />
        <DiagRow label="dirtyParticipantCount" value={diag.dirtyParticipantCount} />
        <DiagRow label="tagAssignmentsDirty" value={diag.tagAssignmentsDirty} />
        <DiagRow label="activeGroupFilter" value={diag.activeGroupFilter} />
        <DiagRow label="userId" value={diag.userId} />
        <DiagRow label="userEmail" value={diag.userEmail} />
        <DiagRow label="appVersion" value={`${APP_VERSION} (${BUILD_LABEL})`} />
      </div>

      <button
        type="button"
        disabled={refreshing || diag.syncBooting}
        onClick={() => void onRefresh()}
        className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs font-medium text-ink transition hover:border-line-strong disabled:opacity-50"
      >
        {refreshing ? "Odświeżanie…" : "Odśwież dane z chmury"}
      </button>

      {message && (
        <p className="text-center text-xs text-accent-soft" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
