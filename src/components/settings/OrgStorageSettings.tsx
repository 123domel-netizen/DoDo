import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, ExternalLink, HardDrive } from "lucide-react";
import {
  disconnectStorage,
  fetchGraphConfigured,
  fetchStorageStatus,
  saveStorageConnection,
  type StorageStatus,
} from "@/lib/chat/galleryApi";

interface OrgStorageSettingsProps {
  orgId: string;
  isAdmin: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  google_drive: "Google Drive",
};

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

  useEffect(() => {
    void refresh();
    setEditing(false);
    setError(null);
    setInfo(null);
  }, [refresh]);

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

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {info && <p className="text-[11px] text-ink-faint">{info}</p>}
    </div>
  );
}
