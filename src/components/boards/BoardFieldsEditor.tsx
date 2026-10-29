import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { useBoardsStore } from "@/lib/boards/store";
import {
  BOARD_FIELD_NAME_MAX,
  BOARD_FIELD_OPTION_MAX,
  BOARD_FIELD_OPTIONS_MAX,
  BOARD_FIELDS_MAX,
  type Board,
  type BoardField,
  type BoardFieldKind,
} from "@/lib/boards/types";

interface OptionDraft {
  id?: string;
  label: string;
}

interface FieldDraft {
  id?: string;
  name: string;
  kind: BoardFieldKind;
  hidden: boolean;
  options: OptionDraft[];
  viewerIds: string[];
}

function emptyDraft(kind: BoardFieldKind = "text"): FieldDraft {
  return {
    name: "",
    kind,
    hidden: false,
    options: kind === "single" || kind === "multi" ? [{ label: "" }, { label: "" }] : [],
    viewerIds: [],
  };
}

function fieldToDraft(f: BoardField): FieldDraft {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    hidden: f.visibility === "restricted",
    options:
      f.kind === "single" || f.kind === "multi"
        ? f.options.map((o) => ({ id: o.id, label: o.label }))
        : [],
    viewerIds: [...f.viewerIds],
  };
}

const KIND_LABEL: Record<BoardFieldKind, string> = {
  single: "Jednokrotny wybór",
  multi: "Wielokrotny wybór",
  text: "Tekst",
};

function fieldTypeLabel(f: BoardField): string {
  const base = KIND_LABEL[f.kind];
  return f.visibility === "restricted" ? `${base} · ukryte` : base;
}

/** Zarządzanie definicjami pól — tylko właściciel tablicy. */
export function BoardFieldsEditor({ board }: { board: Board }) {
  const fields = useBoardsStore((s) => s.fieldsByBoard[board.id] ?? []);
  const loadFields = useBoardsStore((s) => s.loadFields);
  const upsertField = useBoardsStore((s) => s.upsertField);
  const deleteField = useBoardsStore((s) => s.deleteField);
  const [editing, setEditing] = useState<FieldDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFields(board.id);
  }, [board.id, loadFields]);

  const members = useMemo(
    () =>
      [...board.members].sort((a, b) =>
        (a.displayName || a.userId).localeCompare(b.displayName || b.userId, "pl"),
      ),
    [board.members],
  );

  const startCreate = (kind: BoardFieldKind) => {
    if (fields.length >= BOARD_FIELDS_MAX) {
      setError(`Maksymalnie ${BOARD_FIELDS_MAX} pól na tablicę.`);
      return;
    }
    setError(null);
    setEditing(emptyDraft(kind));
  };

  const save = async () => {
    if (!editing || busy) return;
    const name = editing.name.trim();
    if (!name) {
      setError("Podaj nazwę pola.");
      return;
    }
    let options = editing.options
      .map((o) => ({ id: o.id, label: o.label.trim() }))
      .filter((o) => o.label.length > 0);
    if (editing.kind === "single" || editing.kind === "multi") {
      if (options.length < 1) {
        setError("Dodaj co najmniej jedną opcję.");
        return;
      }
      if (options.length > BOARD_FIELD_OPTIONS_MAX) {
        setError(`Maksymalnie ${BOARD_FIELD_OPTIONS_MAX} opcji.`);
        return;
      }
    } else {
      options = [];
    }
    setBusy(true);
    setError(null);
    const res = await upsertField({
      id: editing.id ?? null,
      boardId: board.id,
      name,
      kind: editing.kind,
      visibility: editing.hidden ? "restricted" : "all",
      options,
      viewerIds: editing.hidden ? editing.viewerIds : [],
    });
    setBusy(false);
    if (res.error) setError(res.error);
    else setEditing(null);
  };

  const remove = async (fieldId: string) => {
    if (!window.confirm("Usunąć to pole? Wartości z tematów też znikną.")) return;
    setBusy(true);
    setError(null);
    const res = await deleteField(board.id, fieldId);
    setBusy(false);
    if (res.error) setError(res.error);
    if (editing?.id === fieldId) setEditing(null);
  };

  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-medium text-ink-faint">
        Pola ({fields.length}/{BOARD_FIELDS_MAX})
      </div>

      {fields.length === 0 && !editing && (
        <p className="mb-2 text-xs text-ink-faint">
          Pola pojawią się w każdym temacie na tej tablicy.
        </p>
      )}

      <ul className="mb-2 space-y-0.5">
        {fields.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink"
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setEditing(fieldToDraft(f));
              }}
              className="min-w-0 flex-1 truncate text-left transition hover:text-accent"
            >
              {f.name}
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                {fieldTypeLabel(f)}
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(f.id)}
              className="rounded p-1 text-ink-faint transition hover:bg-surface-raised hover:text-red-400"
              aria-label={`Usuń pole ${f.name}`}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="mb-2 space-y-2 rounded-lg border border-line bg-surface-raised p-2.5">
          <div className="text-[11px] font-medium text-ink-faint">
            {editing.id ? "Edycja pola" : "Nowe pole"} · {KIND_LABEL[editing.kind]}
          </div>
          <input
            value={editing.name}
            maxLength={BOARD_FIELD_NAME_MAX}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="Nazwa pola…"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />

          {(editing.kind === "single" || editing.kind === "multi") && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">Opcje</div>
              {editing.options.map((o, i) => (
                <div key={o.id ?? `new-${i}`} className="flex gap-1">
                  <input
                    value={o.label}
                    maxLength={BOARD_FIELD_OPTION_MAX}
                    onChange={(e) => {
                      const options = [...editing.options];
                      options[i] = { ...o, label: e.target.value };
                      setEditing({ ...editing, options });
                    }}
                    placeholder={`Opcja ${i + 1}`}
                    className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={editing.options.length <= 1}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        options: editing.options.filter((_, j) => j !== i),
                      })
                    }
                    className="rounded px-1.5 text-ink-faint hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {editing.options.length < BOARD_FIELD_OPTIONS_MAX && (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ ...editing, options: [...editing.options, { label: "" }] })
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-ink-light"
                >
                  <Plus size={12} /> Dodaj opcję
                </button>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={editing.hidden}
              onChange={(e) => setEditing({ ...editing, hidden: e.target.checked })}
              className="accent-accent"
            />
            <span>Ukryte — tylko wybrane osoby (i właściciele)</span>
          </label>

          {editing.hidden && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
                Widoczne dla (oprócz właścicieli)
              </div>
              <div className="max-h-36 space-y-0.5 overflow-y-auto thin-scrollbar rounded-md border border-line bg-surface p-1">
                {members.map((m) => (
                  <label
                    key={m.userId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-ink hover:bg-surface-overlay"
                  >
                    <input
                      type="checkbox"
                      checked={editing.viewerIds.includes(m.userId)}
                      onChange={() => {
                        const set = new Set(editing.viewerIds);
                        if (set.has(m.userId)) set.delete(m.userId);
                        else set.add(m.userId);
                        setEditing({ ...editing, viewerIds: [...set] });
                      }}
                      className="accent-accent"
                    />
                    <PersonAvatar userId={m.userId} avatarUrl={m.avatarUrl} size={20} />
                    <span className="min-w-0 flex-1 truncate">
                      {m.displayName || "Użytkownik"}
                      {m.role === "owner" ? " (właściciel)" : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
              className="rounded-md px-2.5 py-1 text-xs text-ink-light hover:bg-surface-overlay"
            >
              Anuluj
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Zapis…" : "Zapisz"}
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap gap-1">
          {(["single", "multi", "text"] as BoardFieldKind[]).map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy || fields.length >= BOARD_FIELDS_MAX}
              onClick={() => startCreate(k)}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-light transition hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              <Plus size={11} /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {error && <div className="mt-1.5 text-xs text-red-400">{error}</div>}
    </div>
  );
}
