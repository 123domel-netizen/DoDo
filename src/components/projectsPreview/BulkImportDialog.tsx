import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  parseBulkProjects,
  type BulkRow,
  type BulkRowErr,
} from "@/lib/projectsPreview/bulkParse";
import {
  PROJECT_KIND_LABEL,
  type ProjectKind,
} from "@/lib/projectsPreview/types";

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

const ERROR_LABEL: Record<BulkRowErr["error"], string> = {
  missing_name: "Brak nazwy",
  invalid_number: "Nieprawidłowy numer",
  unknown_kind: "Nieznany rodzaj",
  duplicate_in_import: "Duplikat w imporcie",
  number_exists: "Numer już istnieje",
};

const KINDS = Object.keys(PROJECT_KIND_LABEL) as ProjectKind[];

export function BulkImportDialog({
  open,
  onClose,
  onImported,
}: BulkImportDialogProps) {
  const repo = useProjectsPreviewRepo();
  const [mode, setMode] = useState<"a" | "b">("a");
  const [sharedKind, setSharedKind] = useState<ProjectKind>("nadzor");
  const [text, setText] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const existingNumbers = useMemo(() => {
    const s = new Set<number>();
    for (const p of repo.getState().projects) s.add(p.number);
    return s;
  }, [repo, open]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh when dialog opens

  const parsed = useMemo(
    () =>
      parseBulkProjects(text, {
        mode,
        sharedKind: mode === "b" ? sharedKind : undefined,
        existingNumbers,
      }),
    [text, mode, sharedKind, existingNumbers],
  );

  const reset = () => {
    setText("");
    setAccepted(false);
    setResultMsg(null);
    setMode("a");
    setSharedKind("nadzor");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const importOk = () => {
    if (!accepted) {
      setResultMsg("Zaakceptuj podsumowanie przed importem.");
      return;
    }
    const okRows = parsed.rows.filter((r): r is Extract<BulkRow, { ok: true }> => r.ok);
    if (okRows.length === 0) {
      setResultMsg("Brak poprawnych wierszy do importu.");
      return;
    }
    const res = repo.importProjects(
      okRows.map((r) => ({ number: r.number, name: r.name, kind: r.kind })),
    );
    if (!res.ok) {
      setResultMsg(res.error);
      return;
    }
    setResultMsg(
      parsed.errorCount > 0
        ? `Zaimportowano ${res.count} projektów. ${parsed.errorCount} wierszy pominięto (błędy).`
        : `Zaimportowano ${res.count} projektów.`,
    );
    onImported?.();
    setTimeout(handleClose, 600);
  };

  return (
    <Modal open={open} onClose={handleClose} width={640}>
      <div className="p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink">Import zbiorczy</h2>
        <p className="mb-4 text-sm text-ink-faint">
          Podgląd przed zapisem. Błędne wiersze nie są importowane — możesz
          zaimportować tylko poprawne po akceptacji podsumowania.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <ModeChip active={mode === "a"} onClick={() => { setMode("a"); setAccepted(false); }}>
            Tryb A — numer; nazwa; rodzaj
          </ModeChip>
          <ModeChip active={mode === "b"} onClick={() => { setMode("b"); setAccepted(false); }}>
            Tryb B — numer nazwa
          </ModeChip>
        </div>

        {mode === "b" ? (
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Wspólny rodzaj
            </span>
            <select
              value={sharedKind}
              onChange={(e) => {
                setSharedKind(e.target.value as ProjectKind);
                setAccepted(false);
              }}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROJECT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAccepted(false);
            setResultMsg(null);
          }}
          rows={7}
          placeholder={
            mode === "a"
              ? "114; Vestino - Więcbork; Nadzór budowy\n115; Dom jednorodzinny - Sępólno; Nadzór budowy"
              : "114 Vestino - Więcbork\n115 Dom jednorodzinny - Sępólno"
          }
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
                          <CheckCircle2 size={12} /> OK
                          {row.ok ? ` #${row.number}` : null}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle size={12} />
                          {ERROR_LABEL[row.error]}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5 text-ink-light">
                      {row.ok
                        ? `${row.name} · ${PROJECT_KIND_LABEL[row.kind]}`
                        : row.raw}
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

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-line text-ink-light hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
