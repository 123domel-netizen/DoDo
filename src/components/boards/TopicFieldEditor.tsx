import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBoardsStore } from "@/lib/boards/store";
import {
  BOARD_FIELD_TEXT_MAX,
  type BoardField,
  type BoardTopic,
  type TopicFieldValue,
} from "@/lib/boards/types";

export function fieldDisplayValue(field: BoardField, value: TopicFieldValue | undefined): string {
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

type PanelPos = { top: number; left: number; width: number };

/**
 * Edycja wartości pola: trigger + mini-popover (single / multi / text).
 * Panel w portalu (fixed) — nie ginie w overflow listy tematów.
 */
export function TopicFieldEditor({
  field,
  topic,
  disabled,
  trigger,
  panelWidth = 176,
}: {
  field: BoardField;
  topic: BoardTopic;
  disabled?: boolean;
  trigger: (args: {
    summary: string;
    empty: boolean;
    open: boolean;
    disabled: boolean;
    toggle: () => void;
  }) => ReactNode;
  panelWidth?: number;
}) {
  const setTopicFieldValue = useBoardsStore((s) => s.setTopicFieldValue);
  const value = topic.fieldValues[field.id];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value?.text ?? "");
  }, [value?.text, field.id, topic.id]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(panelWidth, r.width);
      const gap = 4;
      let top = r.bottom + gap;
      let left = Math.min(r.right - width, r.left);
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const approxH = 220;
      if (top + approxH > window.innerHeight - 8 && r.top > approxH) {
        top = r.top - gap;
        // panel grows upward — anchor bottom via transform in style
        setPos({ top, left, width: -width }); // negative width = flip above
        return;
      }
      setPos({ top, left, width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, panelWidth]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
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
  const summary = fieldDisplayValue(field, value);
  const empty = summary === "—";
  const flipUp = pos != null && pos.width < 0;
  const width = pos ? Math.abs(pos.width) : panelWidth;

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              top: pos.top,
              left: pos.left,
              width,
              transform: flipUp ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-[80] rounded-lg border border-line bg-surface-overlay p-2 shadow-panel"
          >
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
                {field.options.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-ink-faint">Brak opcji — dodaj je w ustawieniach tablicy.</div>
                ) : (
                  field.options.map((o) => (
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
                  ))
                )}
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
                {field.options.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-ink-faint">Brak opcji — dodaj je w ustawieniach tablicy.</div>
                ) : (
                  field.options.map((o) => {
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
                  })
                )}
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        summary,
        empty,
        open,
        disabled: Boolean(disabled),
        toggle: () => {
          if (!disabled) setOpen((v) => !v);
        },
      })}
      {panel}
    </div>
  );
}
