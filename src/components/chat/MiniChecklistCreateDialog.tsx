import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";

interface MiniChecklistCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, items: string[]) => void;
}

const MAX_ITEMS = 12;
const MIN_ITEMS = 1;

/** Mini checklista w rozmowie: tytuł + punkty (odhaczane wspólnie w czacie). */
export function MiniChecklistCreateDialog({
  open,
  onClose,
  onCreate,
}: MiniChecklistCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<string[]>(["", ""]);

  if (!open) return null;

  const cleanItems = items.map((o) => o.trim()).filter(Boolean);
  const canCreate = title.trim().length > 0 && cleanItems.length >= MIN_ITEMS;

  const submit = () => {
    if (!canCreate) return;
    onCreate(title.trim(), cleanItems);
    setTitle("");
    setItems(["", ""]);
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
          <h3 className="text-sm font-semibold text-ink">Mini checklista</h3>
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tytuł (np. Zakupy na budowę)"
          className="mb-2 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
        />

        <div className="flex flex-col gap-1.5">
          {items.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line text-[9px] text-ink-faint">
                {i + 1}
              </span>
              <input
                value={opt}
                onChange={(e) =>
                  setItems(items.map((o, j) => (j === i ? e.target.value : o)))
                }
                placeholder={`Punkt ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="rounded p-1 text-ink-faint transition hover:text-red-400"
                  aria-label={`Usuń punkt ${i + 1}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {items.length < MAX_ITEMS && (
          <button
            type="button"
            onClick={() => setItems([...items, ""])}
            className="mt-2 flex items-center gap-1 text-xs text-accent transition hover:brightness-125"
          >
            <Plus size={13} /> Dodaj punkt
          </button>
        )}

        <p className="mt-2 text-[11px] leading-snug text-ink-faint">
          W czacie da się odhaczać punkty. Później możesz przerobić listę na zadanie lub
          wydarzenie.
        </p>

        <button
          type="button"
          disabled={!canCreate}
          onClick={submit}
          className="mt-4 w-full rounded-xl bg-accent-grad py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
        >
          Wyślij checklistę
        </button>
      </div>
    </div>,
    document.body,
  );
}
