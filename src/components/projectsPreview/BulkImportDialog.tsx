import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { scheduleImportProjects } from "@/lib/schedules/scheduleRepoActions";
import {
  parseBulkProjects,
  type BulkRow,
  type BulkRowErr,
} from "@/lib/projectsPreview/bulkParse";

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

const ERROR_LABEL: Record<BulkRowErr["error"], string> = {
  missing_name: "Brak nazwy",
  invalid_number: "Nieprawidłowy numer / ID",
  duplicate_in_import: "Duplikat w imporcie",
  number_exists: "Numer już istnieje",
};

const PLACEHOLDER = [
  "114 Vestino - Więcbork",
  "B-12; Dom jednorodzinny - Sępólno",
].join("\n");

export function BulkImportDialog({
  open,
  onClose,
  onImported,
}: BulkImportDialogProps) {
  const repo = useProjectsPreviewRepo();
  const [text, setText] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const existingNumbers = useMemo(() => {
    const s = new Set<string>();
    for (const p of repo.getState().projects) s.add(p.number.toLowerCase());
    return s;
  }, [repo, open]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh when dialog opens

  const parsed = useMemo(
    () => parseBulkProjects(text, { existingNumbers }),
    [text, existingNumbers],
  );

  const reset = () => {
    setText("");
    setAccepted(false);
    setResultMsg(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const importOk = async () => {
    if (!accepted) {
      setResultMsg("Zaakceptuj podsumowanie przed importem.");
      return;
    }
    const okRows = parsed.rows.filter((r): r is Extract<BulkRow, { ok: true }> => r.ok);
    if (okRows.length === 0) {
      setResultMsg("Brak poprawnych wierszy do importu.");
      return;
    }
    const res = await scheduleImportProjects(
      repo,
      okRows.map((r) => ({ number: r.number, name: r.name })),
    );
    if (!res.ok) {
      setResultMsg(res.error);
      return;
    }
    setResultMsg(
      parsed.errorCount > 0
        ? `Zaimportowano ${res.count} budów. ${parsed.errorCount} wierszy pominięto (błędy).`
        : `Zaimportowano ${res.count} budów.`,
    );
    onImported?.();
    setTimeout(handleClose, 600);
  };

  return (
    <Modal open={open} onClose={handleClose} width={640}>
      <div className="p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink">Import zbiorczy</h2>
        <p className="mb-3 text-sm text-ink-faint">
          Jeden wiersz = jedna budowa: <code className="text-ink-light">114 Vestino</code>{" "}
          lub <code className="text-ink-light">B-12; Vestino</code>. Numer / ID może być
          dowolnym tekstem. Podgląd przed zapisem — błędne wiersze nie są importowane.
        </p>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAccepted(false);
            setResultMsg(null);
          }}
          rows={7}
          placeholder={PLACEHOLDER}
          className="mb-3 w-full resize-y rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs text-ink outline-none focus:border-line-strong"
        />

        {parsed.rows.length > 0 ? (
          <div className="mb-3 max-h-48 overflow-auto thin-scrollbar rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-raised text-[10px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-2 py-1.5">Wiersz</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Treść</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((row) => (
                  <tr key={row.line} className="border-t border-line/60">
                    <td className="px-2 py-1.5 text-ink-faint">{row.line}</td>
                    <td className="px-2 py-1.5">
                      {row.ok ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={12} /> OK #{row.number}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle size={12} />
                          {ERROR_LABEL[row.error]}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5 text-ink-light">
                      {row.ok ? row.name : row.raw}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {parsed.rows.length > 0 ? (
          <div className="mb-3 rounded-lg border border-line bg-surface-raised/40 px-3 py-2 text-xs text-ink-light">
            Poprawne: <strong className="text-ink">{parsed.okCount}</strong>
            {" · "}
            Błędy (zablokowane):{" "}
            <strong className="text-amber-400">{parsed.errorCount}</strong>
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Akceptuję podsumowanie i importuję wyłącznie poprawne wiersze
                {parsed.errorCount > 0
                  ? ` (pomijam ${parsed.errorCount} z błędami)`
                  : ""}
                .
              </span>
            </label>
          </div>
        ) : null}

        {resultMsg ? (
          <p className="mb-2 text-sm text-ink-light" role="status">
            {resultMsg}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-light transition hover:text-ink"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={importOk}
            disabled={!accepted || parsed.okCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Upload size={14} />
            Importuj poprawne
          </button>
        </div>
      </div>
    </Modal>
  );
}
