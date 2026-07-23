import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, ExternalLink, HardDrive, RotateCw } from "lucide-react";
import {
  disconnectStorage,
  fetchGraphConfigured,
  fetchOrgMediaPipeline,
  fetchStorageStatus,
  saveStorageConnection,
  setOrgMediaPipeline,
  type StorageStatus,
} from "@/lib/chat/galleryApi";
import { supabase, cloudEnabled } from "@/lib/supabase";

interface OrgStorageSettingsProps {
  orgId: string;
  isAdmin: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  google_drive: "Google Drive",
};

type SyncFailRow = { id: string; file_name: string; sync_last_error: string | null };

/** Magazyn plików zespołu (galerie w czacie) — V1: ręczne ID z Graph/SharePoint. */
export function OrgStorageSettings({ orgId, isAdmin }: OrgStorageSettingsProps) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [driveId, setDriveId] = useState("");
  const [baseFolderId, setBaseFolderId] = useState("");
  const [baseFolderName, setBaseFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [syncFails, setSyncFails] = useState<SyncFailRow[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [mediaPipeline, setMediaPipeline] = useState<"legacy_sp" | "r2_sp">("legacy_sp");
  const [pipelineSaving, setPipelineSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetchStorageStatus(orgId);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      // Nie kasuj poprzedniego statusu przy chwilowej awarii — unikaj fałszywego „Podłącz”.
      return null;
    }
    setError(null);
    const s = res.data ?? null;
    setStatus(s);
    return s;
  }, [orgId]);

  const refreshSyncFails = useCallback(async () => {
    if (!isAdmin || !supabase) {
      setSyncFails([]);
      return;
    }
    const { data } = await supabase
      .from("gallery_items")
      .select("id, file_name, sync_last_error, galleries!inner(org_id)")
      .eq("galleries.org_id", orgId)
      .in("sp_status", ["failed", "permanent_failure"])
      .eq("r2_status", "ready")
      .limit(20);
    setSyncFails(
      ((data as Array<{ id: string; file_name: string; sync_last_error: string | null }>) ?? []).map(
        (r) => ({
          id: r.id,
          file_name: r.file_name,
          sync_last_error: r.sync_last_error,
        }),
      ),
    );
  }, [isAdmin, orgId]);

  const refreshPipeline = useCallback(async () => {
    const res = await fetchOrgMediaPipeline(orgId);
    if (res.data?.mediaPipeline) setMediaPipeline(res.data.mediaPipeline);
    else setMediaPipeline("legacy_sp");
  }, [orgId]);

  useEffect(() => {
    void refresh();
    void refreshSyncFails();
    void refreshPipeline();
    setEditing(false);
    setError(null);
    setInfo(null);
  }, [refresh, refreshSyncFails, refreshPipeline]);

  const setPipeline = async (next: "legacy_sp" | "r2_sp") => {
    if (next === "r2_sp" && !status?.connected) {
      setError(
        "Aby włączyć R2, najpierw podłącz aktywny magazyn SharePoint (site, drive, folder).",
      );
      return;
    }
    setPipelineSaving(true);
    setError(null);
    const res = await setOrgMediaPipeline(orgId, next);
    setPipelineSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setMediaPipeline(res.data?.mediaPipeline ?? next);
    setInfo(
      next === "r2_sp"
        ? "Pipeline galerii: R2 (hot) + SharePoint (archiwum)."
        : "Pipeline galerii: legacy SharePoint (natychmiastowy rollback).",
    );
  };

  const retrySync = async (itemId: string) => {
    if (!supabase) return;
    setRetryingId(itemId);
    const { error: rpcErr } = await supabase.rpc("retry_gallery_item_sync", {
      p_item_id: itemId,
    });
    if (rpcErr) {
      setRetryingId(null);
      setError(rpcErr.message);
      return;
    }
    // Natychmiastowy enqueue do Workera (cron też złapie, ale wolniej).
    if (cloudEnabled) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
          const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
          await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "media_enqueue_gallery_item",
              itemId,
            }),
          });
        }
      } catch {
        // best-effort — cron Workera i tak ponowi
      }
    }
    setRetryingId(null);
    setInfo("Ponowiono synchronizację do SharePoint.");
    await refreshSyncFails();
  };

  const openForm = (prefill: StorageStatus | null) => {
    setSiteId(prefill?.siteId ?? "");
    setDriveId(prefill?.driveId ?? "");
    setBaseFolderId(prefill?.baseFolderId ?? "");
    setBaseFolderName(prefill?.baseFolderName ?? "");
    setError(null);
    setInfo(null);
    setEditing(true);
    void fetchGraphConfigured(orgId).then((ok) => {
      setStatus((prev) => (prev ? { ...prev, graphConfigured: ok } : prev));
    });
  };

  const save = async () => {
    if (!siteId.trim() || !driveId.trim() || !baseFolderId.trim() || !baseFolderName.trim()) {
      setError("Wypełnij wszystkie pola.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveStorageConnection({
      orgId,
      siteId: siteId.trim(),
      driveId: driveId.trim(),
      baseFolderId: baseFolderId.trim(),
      baseFolderName: baseFolderName.trim(),
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEditing(false);
    setInfo("Magazyn plików podłączony.");
    await refresh();
  };

  const disconnect = async () => {
    if (!confirm("Odłączyć magazyn plików zespołu? Istniejące galerie przestaną być dostępne.")) {
      return;
    }
    setSaving(true);
    setError(null);
    const res = await disconnectStorage(orgId);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setInfo("Magazyn plików odłączony.");
    await refresh();
  };

  return (
    <div className="space-y-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        Magazyn plików (galerie w czacie)
      </div>

      {loading ? (
        <p className="text-[11px] text-ink-faint">Wczytywanie…</p>
      ) : editing && isAdmin ? (
        <div className="space-y-2 rounded-lg border border-line bg-surface-raised p-2">
          {status && !status.graphConfigured && (
            <p className="text-[11px] leading-snug text-amber-400">
              Microsoft Graph nie jest jeszcze skonfigurowany na serwerze — zapisanie
              połączenia może się nie powiedzie, dopóki administrator aplikacji nie
              uzupełni sekretów.
            </p>
          )}
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-faint">
            <HardDrive size={13} className="mt-0.5 shrink-0" />
            Wersja V1: podaj identyfikatory z{" "}
            <a
              href="https://learn.microsoft.com/en-us/graph/api/resources/sharepoint"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              Microsoft Graph <ExternalLink size={10} />
            </a>{" "}
            (site, drive i folder w SharePoint zespołu).
          </p>
          <input
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="Site ID"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          />
          <input
            value={driveId}
            onChange={(e) => setDriveId(e.target.value)}
            placeholder="Drive ID"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          />
          <input
            value={baseFolderId}
            onChange={(e) => setBaseFolderId(e.target.value)}
            placeholder="Base Folder ID"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          />
          <input
            value={baseFolderName}
            onChange={(e) => setBaseFolderName(e.target.value)}
            placeholder="Nazwa folderu (wyświetlana w DoDo)"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="flex-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Zapisz
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="rounded-lg px-2 py-1.5 text-xs text-ink-faint transition hover:text-ink"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2 py-1.5">
          {status?.connected ? (
            <Cloud size={15} className="shrink-0 text-accent" />
          ) : (
            <CloudOff size={15} className="shrink-0 text-ink-faint" />
          )}
          <div className="min-w-0 flex-1">
            {status?.connected ? (
              <>
                <div className="truncate text-sm text-ink">
                  Podłączony: {PROVIDER_LABEL[status.provider ?? ""] ?? status.provider}
                </div>
                <div className="truncate text-[11px] text-ink-faint">
                  {status.baseFolderName ?? "Folder zespołu"}
                </div>
              </>
            ) : status?.baseFolderId ? (
              <>
                <div className="truncate text-sm text-ink">Magazyn odłączony</div>
                <div className="truncate text-[11px] text-ink-faint">
                  {status.baseFolderName ?? "Folder zespołu"} — kliknij Podłącz, by wznowić
                </div>
              </>
            ) : (
              <div className="text-sm text-ink-faint">Brak magazynu</div>
            )}
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => openForm(status)}
                className="rounded-lg px-2 py-1 text-[11px] text-accent transition hover:underline"
              >
                {status?.connected ? "Zmień" : "Podłącz"}
              </button>
              {status?.connected && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void disconnect()}
                  className="rounded-lg px-2 py-1 text-[11px] text-red-400 transition hover:underline disabled:opacity-50"
                >
                  Odłącz
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!isAdmin && !status?.connected && !loading && (
        <p className="text-[11px] leading-snug text-ink-faint">
          Galerie w czacie wymagają magazynu plików podłączonego przez administratora zespołu.
        </p>
      )}

      {isAdmin && (
        <div className="rounded-lg border border-line bg-surface-raised px-2 py-1.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Pipeline galerii (serwer)
          </div>
          <p className="mb-1.5 text-[11px] leading-snug text-ink-faint">
            Domyślnie legacy. R2 wymaga aktywnego magazynu SharePoint.
            Bez magazynu zespół pozostaje na legacy_sp.
          </p>
          {!status?.connected && (
            <p className="mb-1.5 text-[11px] leading-snug text-amber-400">
              Podłącz i zweryfikuj magazyn SharePoint, zanim włączysz R2 + SP.
            </p>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pipelineSaving || mediaPipeline === "legacy_sp"}
              onClick={() => void setPipeline("legacy_sp")}
              className="rounded-lg px-2 py-1 text-[11px] text-ink transition hover:underline disabled:opacity-40"
            >
              Legacy SP
            </button>
            <button
              type="button"
              disabled={
                pipelineSaving ||
                mediaPipeline === "r2_sp" ||
                !status?.connected
              }
              onClick={() => void setPipeline("r2_sp")}
              className="rounded-lg px-2 py-1 text-[11px] text-accent transition hover:underline disabled:opacity-40"
              title={
                !status?.connected
                  ? "Najpierw podłącz aktywny magazyn SharePoint"
                  : undefined
              }
            >
              R2 + SP
            </button>
            <span className="ml-auto self-center text-[10px] text-ink-faint">
              teraz: {mediaPipeline === "r2_sp" ? "r2_sp" : "legacy_sp"}
            </span>
          </div>
        </div>
      )}

      {isAdmin && syncFails.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-400/90">
            Problem z archiwizacją SharePoint
          </div>
          <ul className="space-y-1">
            {syncFails.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 text-[11px] text-ink-light"
              >
                <span className="min-w-0 flex-1 truncate" title={row.sync_last_error ?? undefined}>
                  {row.file_name}
                </span>
                <button
                  type="button"
                  disabled={retryingId === row.id}
                  onClick={() => void retrySync(row.id)}
                  className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline disabled:opacity-50"
                >
                  <RotateCw size={11} className={retryingId === row.id ? "animate-spin" : ""} />
                  Ponów
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {info && <p className="text-[11px] text-ink-faint">{info}</p>}
    </div>
  );
}
