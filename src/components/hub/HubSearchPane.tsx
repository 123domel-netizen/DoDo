import { useStore } from "@/state/store";
import { jumpToMessage, openConversation } from "@/lib/chat/init";
import type { ChatSearchResult } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { setRouteHash } from "@/lib/navigation";

/** Wyniki globalnego wyszukiwania (pole szukania jest w belce hubu). */
export function HubSearchPane({
  results,
  searching,
}: {
  results: ChatSearchResult[] | null;
  searching: boolean;
}) {
  const setEditing = useStore((s) => s.setEditing);

  const open = (r: ChatSearchResult) => {
    if (r.resultType === "item" && r.itemId) {
      setEditing(r.itemId);
      return;
    }
    if (!r.conversationId) return;
    void openConversation(r.conversationId).then(() => {
      if (r.resultType === "message") void jumpToMessage(r.conversationId!, r.id);
    });
    setRouteHash({ view: "conversation", conversationId: r.conversationId });
  };

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {searching && (
        <div className="px-3 py-4 text-center text-[11px] text-ink-faint">Szukam…</div>
      )}
      {!searching && results === null && (
        <div className="px-6 py-10 text-center text-xs text-ink-faint">
          Wpisz frazę i naciśnij Enter.
        </div>
      )}
      {!searching && results?.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Brak wyników.</div>
      )}
      {results?.map((r) => (
        <button
          key={`${r.resultType}-${r.id}`}
          type="button"
          onClick={() => open(r)}
          className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
        >
          <span className="line-clamp-2 text-sm text-ink">
            {r.title || r.snippet || "(bez tytułu)"}
          </span>
          <span className="text-[10px] text-ink-faint">
            {r.resultType === "message"
              ? "wiadomość"
              : r.resultType === "item"
                ? "wpis"
                : "plik"}
            {r.createdAt ? ` · ${formatMessageTime(r.createdAt)}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
