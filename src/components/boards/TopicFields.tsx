import { useEffect, useRef, useState } from "react";
import { useBoardsStore } from "@/lib/boards/store";
import {
  BOARD_FIELD_TEXT_MAX,
  type BoardField,
  type BoardTopic,
  type TopicFieldValue,
} from "@/lib/boards/types";

function displayValue(field: BoardField, value: TopicFieldValue | undefined): string {
  if (field.kind === "text") {
    const t = value?.text?.trim();
    return t || "—";
  }
  const ids = value?.optionIds ?? [];
  if (ids.length === 0) return "—";
  const labels = ids
    .map((id) => field.options.find((o) => o.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  return labels.length > 0 ? labels.join(", ") : "—";
}

function FieldRow({
  field,
  topic,
  disabled,
}: {
  field: BoardField;
  topic: BoardTopic;
  disabled?: boolean;
}) {
  const setTopicFieldValue = useBoardsStore((s) => s.setTopicFieldValue);
  const value = topic.fieldValues[field.id];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.text ?? "");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value?.text ?? "");
  }, [value?.text, field.id, topic.id]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const saveText = async () => {
    const clean = text.trim();
    const prev = (value?.text ?? "").trim();
    if (clean === prev || disabled) {
      setOpen(false);
      return;
    }
    setBusy(true);
    await setTopicFieldValue({
      topicId: topic.id,
      fieldId: field.id,
      textValue: clean || null,
      optionIds: [],
    });
    setBusy(false);
    setOpen(false);
  };

  const saveOptions = async (optionIds: string[], closeAfter: boolean) => {
    if (disabled) return;
    setBusy(true);
    await setTopicFieldValue({
      topicId: topic.id,
      fieldId: field.id,
      textValue: null,
      optionIds,
    });
    setBusy(false);
    if (closeAfter) setOpen(false);
  };

  const selected = new Set(value?.optionIds ?? []);
  const summary = displayValue(field, value);
  const empty = summary === "—";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-surface-raised disabled:opacity-50"
      >
        <span className="shrink-0 text-[11px] font-medium text-ink-faint">
          {field.name}
          {field.visibility === "restricted" ? (
            <span className="ml-1 font-normal opacity-70" title="Widoczne tylko dla wybranych osób">
              · ukryte
            </span>
          ) : null}
          :
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${empty ? "text-ink-faint" : "text-ink"}`}
        >
          {summary}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-0.5 rounded-lg border border-line bg-surface-overlay p-2 shadow-panel">
          {field.kind === "text" && (
            <input
              autoFocus
              value={text}
              maxLength={BOARD_FIELD_TEXT_MAX}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void saveText()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveText();
                }
              }}
              placeholder="—"
              className="w-full rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          )}

          {field.kind === "single" && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto thin-scrollbar">
              {field.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void saveOptions([o.id], true)}
                  className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-surface-raised ${
                    selected.has(o.id) ? "text-accent" : "text-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
              {selected.size > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveOptions([], true)}
                  className="px-2 py-1 text-[11px] text-ink-faint hover:text-ink-light"
                >
                  Wyczyść
                </button>
              )}
            </div>
          )}

          {field.kind === "multi" && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto thin-scrollbar">
              {field.options.map((o) => {
                const on = selected.has(o.id);
                return (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => {
                        const next = new Set(selected);
                        if (on) next.delete(o.id);
                        else next.add(o.id);
                        void saveOptions([...next], false);
                      }}
                      className="accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </label>
                );
              })}
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="mt-1 w-full rounded-md px-2 py-1 text-[11px] text-ink-faint hover:bg-surface-raised hover:text-ink-light"
              >
                Gotowe
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Wartości pól tablicy w szczegółach tematu (kompakt: etykieta + wartość, klik = edycja). */
export function TopicFields({ topic }: { topic: BoardTopic }) {
  const fields = useBoardsStore((s) => s.fieldsByBoard[topic.boardId] ?? []);
  const loadFields = useBoardsStore((s) => s.loadFields);
  const pending = Boolean(topic.sendState);

  useEffect(() => {
    void loadFields(topic.boardId);
  }, [topic.boardId, loadFields]);

  // Lista z get_board_fields jest już przefiltrowana (ukryte tylko dla ownerów / viewerów).
  if (fields.length === 0) return null;

  return (
    <div className="mt-2 border-t border-line/50 pt-2">
      <div className="mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        Pola
      </div>
      <div className="space-y-0.5">
        {fields.map((f) => (
          <FieldRow key={f.id} field={f} topic={topic} disabled={pending} />
        ))}
      </div>
    </div>
  );
}
