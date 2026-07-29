import { useState, type ReactNode } from "react";
import { Users, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { PreviewCrew } from "@/lib/projectsPreview/types";

/** Soft palette for timeline bars — similar hues sit next to each other. */
export const CREW_COLORS = [
  // blue
  "#6b8ab8",
  "#5a7399",
  // teal / cyan
  "#6aadb8",
  "#5a9eab",
  "#4a8894",
  // green
  "#6aaf90",
  "#5a9e84",
  "#4a8570",
  // yellow / gold
  "#d4b56a",
  "#c4a35a",
  "#a88a48",
  // orange / terracotta
  "#d49a6a",
  "#c48a5c",
  "#a87348",
  // rose / red
  "#d48a8a",
  "#c47a7a",
  "#a86262",
  // purple / lavender
  "#a090c4",
  "#8f7eb8",
  "#7464a0",
  // slate / grey
  "#8a94a4",
  "#7a8494",
];

interface CrewEditorSheetProps {
  /** null = new brygada. */
  crew: PreviewCrew | null;
  onClose: () => void;
  onSave: (data: Omit<PreviewCrew, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}

/** Add/edit sheet for a brygada. Shared by the board and the Brygady view. */
export function CrewEditorSheet({
  crew,
  onClose,
  onSave,
  onDelete,
}: CrewEditorSheetProps) {
  const [name, setName] = useState(crew?.name ?? "");
  const [headcount, setHeadcount] = useState(
    crew?.headcount != null ? String(crew.headcount) : "",
  );
  const [supervisor, setSupervisor] = useState(crew?.supervisor ?? "");
  const [company, setCompany] = useState(crew?.company ?? "");
  const [phone, setPhone] = useState(crew?.phone ?? "");
  const [color, setColor] = useState(crew?.color ?? CREW_COLORS[0]!);

  const submit = () => {
    if (!name.trim()) {
      alert("Podaj nazwę brygady.");
      return;
    }
    const parsed =
      headcount.trim() === "" ? null : Number.parseInt(headcount, 10);
    if (headcount.trim() !== "" && (Number.isNaN(parsed) || parsed! < 0)) {
      alert("Ilość osób musi być liczbą ≥ 0.");
      return;
    }
    onSave({
      id: crew?.id,
      name: name.trim(),
      color,
      headcount: parsed,
      supervisor: supervisor.trim(),
      company: company.trim(),
      phone: phone.trim(),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[9200] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Users size={14} className="text-accent" />
            {crew ? "Edycja brygady" : "Nowa brygada"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2.5">
          <Field label="Nazwa">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="np. Brygada stolarska"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ilość osób">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                placeholder="np. 6"
              />
            </Field>
            <Field label="Telefon">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                placeholder="+48 …"
              />
            </Field>
          </div>
          <Field label="Osoba nadzorująca">
            <input
              value={supervisor}
              onChange={(e) => setSupervisor(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="Imię i nazwisko"
            />
          </Field>
          <Field label="Nazwa firmy">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="Firma / podwykonawca"
            />
          </Field>
          <Field label="Kolor na osi">
            <div className="flex flex-wrap gap-2">
              {CREW_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition ${
                    color === c
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-overlay"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="mt-2 h-8 w-full cursor-pointer rounded border border-line bg-surface-raised"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30"
            >
              Usuń
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-ink-light"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
            >
              Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
