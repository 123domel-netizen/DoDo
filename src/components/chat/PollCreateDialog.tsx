import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";

interface PollCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[]) => void;
}

const MAX_OPTIONS = 8;

/** Ankieta w rozmowie: pytanie + 2–8 opcji (jeden głos na osobę). */
export function PollCreateDialog({ open, onClose, onCreate }: PollCreateDialogProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["Tak", "Nie"]);

  if (!open) return null;

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
  const canCreate = question.trim().length > 0 && cleanOptions.length >= 2;

  const submit = () => {
    if (!canCreate) return;
    onCreate(question.trim(), cleanOptions);
    setQuestion("");
    setOptions(["Tak", "Nie"]);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Nowa ankieta</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pytanie (np. Który termin pasuje?)"
          className="mb-2 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
        />

        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={opt}
                onChange={(e) =>
                  setOptions(options.map((o, j) => (j === i ? e.target.value : o)))
                }
                placeholder={`Opcja ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  className="rounded p-1 text-ink-faint transition hover:text-red-400"
                  aria-label={`Usuń opcję ${i + 1}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions([...options, ""])}
            className="mt-2 flex items-center gap-1 text-xs text-accent transition hover:brightness-125"
          >
            <Plus size={13} /> Dodaj opcję
          </button>
        )}

        <button
          type="button"
          disabled={!canCreate}
          onClick={submit}
          className="mt-4 w-full rounded-xl bg-accent-grad py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
        >
          Utwórz ankietę
        </button>
      </div>
    </div>,
    document.body,
  );
}
