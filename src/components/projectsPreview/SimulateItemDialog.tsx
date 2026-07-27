import type { ReactNode } from "react";
import { CalendarPlus, ListTodo, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { ScheduleBlock } from "@/lib/projectsPreview/types";
import { projectLabel, type PreviewProject } from "@/lib/projectsPreview/types";

export type SimulateKind = "task" | "event";

interface SimulateItemDialogProps {
  open: boolean;
  kind: SimulateKind;
  project: PreviewProject;
  block: ScheduleBlock;
  crewName: string;
  onClose: () => void;
}

/** Interactive mock of Create task / event — no real store writes. */
export function SimulateItemDialog({
  open,
  kind,
  project,
  block,
  crewName,
  onClose,
}: SimulateItemDialogProps) {
  const title =
    kind === "task"
      ? `Zadanie: ${block.title}`
      : `Wydarzenie: ${block.title}`;

  return (
    <Modal open={open} onClose={onClose} width={440}>
      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          {kind === "task" ? (
            <ListTodo size={16} className="text-accent" />
          ) : (
            <CalendarPlus size={16} className="text-accent" />
          )}
          <h2 className="text-base font-semibold text-ink">
            Symulacja — {kind === "task" ? "utwórz zadanie" : "utwórz wydarzenie"}
          </h2>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Podgląd formularza. Nic nie trafia do produkcyjnych Zadań ani Kalendarza.
        </p>

        <div className="space-y-3">
          <Field label="Tytuł">
            <input
              readOnly
              value={title}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label="Projekt">
            <input
              readOnly
              value={projectLabel(project)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Od">
              <input
                readOnly
                value={block.startDate}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Do">
              <input
                readOnly
                value={block.endDate}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          <Field label="Odpowiedzialny / ekipa">
            <input
              readOnly
              value={crewName}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
          {block.note ? (
            <Field label="Notatka">
              <textarea
                readOnly
                value={block.note}
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:text-ink"
          >
            <X size={14} />
            Zamknij
          </button>
          <button
            type="button"
            disabled
            className="rounded-lg bg-accent/40 px-3 py-1.5 text-sm font-semibold text-white opacity-60"
            title="Niedostępne w preview"
          >
            Zapisz (niedostępne)
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
