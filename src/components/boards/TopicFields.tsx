import { useEffect, useState } from "react";
import { useBoardsStore } from "@/lib/boards/store";
import {
  BOARD_FIELD_TEXT_MAX,
  type BoardField,
  type BoardTopic,
} from "@/lib/boards/types";

function FieldControl({
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
  const [text, setText] = useState(value?.text ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(value?.text ?? "");
  }, [value?.text, field.id, topic.id]);

  const saveText = async () => {
    const clean = text.trim();
    const prev = (value?.text ?? "").trim();
    if (clean === prev || disabled) return;
    setBusy(true);
    await setTopicFieldValue({
      topicId: topic.id,
      fieldId: field.id,
      textValue: clean || null,
      optionIds: [],
    });
    setBusy(false);
  };

  const saveOptions = async (optionIds: string[]) => {
    if (disabled) return;
    setBusy(true);
    await setTopicFieldValue({
      topicId: topic.id,
      fieldId: field.id,
      textValue: null,
      optionIds,
    });
    setBusy(false);
  };

  const selected = new Set(value?.optionIds ?? []);

  return (
    <div className="rounded-md px-1 py-1.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[11px] font-medium text-ink-faint">{field.name}</span>
        {field.visibility === "restricted" && (
          <span className="text-[10px] uppercase tracking-wide text-ink-faint/80">Ukryte</span>
        )}
      </div>

      {field.kind === "text" && (
        <input
          value={text}
          maxLength={BOARD_FIELD_TEXT_MAX}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void saveText()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          className="w-full rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-accent disabled:opacity-50"
        />
      )}

      {field.kind === "single" && (
        <div className="space-y-0.5">
          {field.options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
            >
              <input
                type="radio"
                name={`field-${topic.id}-${field.id}`}
                checked={selected.has(o.id)}
                disabled={disabled || busy}
                onChange={() => void saveOptions([o.id])}
                className="accent-accent"
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void saveOptions([])}
              className="px-1.5 text-[11px] text-ink-faint hover:text-ink-light"
            >
              Wyczyść
            </button>
          )}
        </div>
      )}

      {field.kind === "multi" && (
        <div className="space-y-0.5">
          {field.options.map((o) => {
            const on = selected.has(o.id);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled || busy}
                  onChange={() => {
                    const next = new Set(selected);
                    if (on) next.delete(o.id);
                    else next.add(o.id);
                    void saveOptions([...next]);
                  }}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Wartości pól tablicy w szczegółach tematu. */
export function TopicFields({ topic }: { topic: BoardTopic }) {
  const fields = useBoardsStore((s) => s.fieldsByBoard[topic.boardId] ?? []);
  const loadFields = useBoardsStore((s) => s.loadFields);
  const pending = Boolean(topic.sendState);

  useEffect(() => {
    void loadFields(topic.boardId);
  }, [topic.boardId, loadFields]);

  if (fields.length === 0) return null;

  return (
    <div className="mt-2 border-t border-line/50 pt-2">
      <div className="mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        Pola
      </div>
      <div className="space-y-0.5">
        {fields.map((f) => (
          <FieldControl key={f.id} field={f} topic={topic} disabled={pending} />
        ))}
      </div>
    </div>
  );
}
