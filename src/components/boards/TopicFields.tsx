import { useEffect } from "react";
import { FieldValueChips, TopicFieldEditor } from "@/components/boards/TopicFieldEditor";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardTopic } from "@/lib/boards/types";

/** Wartości pól tablicy w szczegółach tematu (kompaktowa siatka). */
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
    <div className="mt-1 border-t border-line/40 pt-1">
      <div className="mb-0.5 px-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
        Pola
      </div>
      <div className="grid grid-cols-1 gap-x-2 gap-y-px sm:grid-cols-2">
        {fields.map((f) => (
          <TopicFieldEditor
            key={f.id}
            field={f}
            topic={topic}
            disabled={pending}
            panelWidth={240}
            trigger={({ summary, empty, disabled, toggle }) => (
              <button
                type="button"
                disabled={disabled}
                onClick={toggle}
                className="flex w-full min-w-0 items-baseline gap-1 rounded px-0.5 py-px text-left transition hover:bg-surface-raised disabled:opacity-50"
              >
                <span className="max-w-[45%] shrink-0 truncate text-[10px] font-medium text-ink-faint">
                  {f.name}
                  {f.visibility === "restricted" ? (
                    <span
                      className="ml-0.5 font-normal opacity-60"
                      title="Widoczne tylko dla wybranych osób"
                    >
                      · ukr.
                    </span>
                  ) : null}
                  :
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] ${empty ? "text-ink-faint" : "text-ink"}`}
                >
                  {empty ? (
                    summary
                  ) : (
                    <FieldValueChips field={f} value={topic.fieldValues[f.id]} />
                  )}
                </span>
              </button>
            )}
          />
        ))}
      </div>
    </div>
  );
}
