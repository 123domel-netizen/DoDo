import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { GROUP_COLORS } from "@/lib/factory";

interface AddGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, color: string) => void;
  groupCount: number;
}

export function AddGroupDialog({ open, onClose, onAdd, groupCount }: AddGroupDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, GROUP_COLORS[groupCount % GROUP_COLORS.length]);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={400}>
      <div className="p-5">
        <h2 className="mb-3 text-lg font-semibold text-ink">Nowa grupa</h2>
        <p className="mb-3 text-sm text-ink-light">
          Grupy to kategorie (np. Zakupy, Rodzina) — filtrują kalendarz i listę zadań.
        </p>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Nazwa grupy…"
          className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-light transition hover:text-ink"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Dodaj
          </button>
        </div>
      </div>
    </Modal>
  );
}
