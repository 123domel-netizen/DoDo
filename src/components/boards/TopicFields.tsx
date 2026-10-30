import { useEffect } from "react";
import { TopicFieldEditor } from "@/components/boards/TopicFieldEditor";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardTopic } from "@/lib/boards/types";

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
          <TopicFieldEditor
            key={f.id}
            field={f}
            topic={topic}
            disabled={pending}
            panelClassName="absolute left-0 right-0 z-20 mt-0.5 rounded-lg border border-line bg-surface-overlay p-2 shadow-panel"
            trigger={({ summary, empty, disabled, toggle }) => (
              <button
                type="button"
                disabled={disabled}
                onClick={toggle}
                className="flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-surface-raised disabled:opacity-50"
              >
                <span className="shrink-0 text-[11px] font-medium text-ink-faint">
                  {f.name}
                  {f.visibility === "restricted" ? (
                    <span
                      className="ml-1 font-normal opacity-70"
                      title="Widoczne tylko dla wybranych osób"
                    >
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
            )}
          />
        ))}
      </div>
    </div>
  );
}
