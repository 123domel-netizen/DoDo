import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import {
  flushPendingPush,
  getSyncDiagnosticsSnapshot,
} from "@/lib/cloud";
import { cloudEnabled } from "@/lib/supabase";
import { beginSyncDebugCorrelation, getWatchedItemId, isSyncDebugEnabled, syncDebugTrace } from "@/lib/syncDebug";

/**
 * Widoczny alert, gdy lokalne zmiany nie wyszły do chmury.
 * Bez tego użytkownik widzi wydarzenie na telefonie, a PC milczy —
 * a diagnostyka była schowana głęboko w ustawieniach.
 */
export function SyncPendingBanner() {
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloudEnabled) return;
    const tick = () => {
      const d = getSyncDiagnosticsSnapshot();
      setPending(
        d.dirtyItemsCount + d.dirtyParticipantCount + (d.tagAssignmentsDirty ? 1 : 0),
      );
      setError(d.lastPushError);
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, []);

  if (!cloudEnabled || pending <= 0) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-2 text-[12px] text-ink"
    >
      <CloudOff size={16} className="shrink-0 text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        {pending === 1
          ? "1 zmiana nie wyszła jeszcze do chmury — inne urządzenia jej nie widzą."
          : `${pending} zmian nie wyszło jeszcze do chmury — inne urządzenia ich nie widzą.`}
        {error ? ` (${error})` : ""}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (isSyncDebugEnabled()) {
            const correlationId = beginSyncDebugCorrelation();
            syncDebugTrace({
              correlationId,
              itemId: getWatchedItemId(),
              stage: "SEND_CLICKED",
              result: "banner_wyslij",
              snapshot: { pending, error },
            });
          }
          setBusy(true);
          void flushPendingPush().finally(() => setBusy(false));
        }}
        className="shrink-0 rounded-md bg-amber-500/25 px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:bg-amber-500/40 disabled:opacity-50"
      >
        {busy ? "Wysyłanie…" : "Wyślij"}
      </button>
    </div>
  );
}
