import { useState } from "react";
import { Search, X } from "lucide-react";
import { useStore } from "@/state/store";
import { jumpToMessage, openConversation } from "@/lib/chat/init";
import { searchAll } from "@/lib/chat/api";
import type { ChatSearchResult } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { setRouteHash } from "@/lib/navigation";

/** Globalne wyszukiwanie w hubie (wiadomości, wpisy, pliki). */
export function HubSearchPane() {
  const setEditing = useStore((s) => s.setEditing);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchAll(q));
    } finally {
      setSearching(false);
    }
  };

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-2 py-1.5">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) setResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
            placeholder="Szukaj wszędzie…"
            className="w-full rounded-md border border-line bg-surface-raised py-1.5 pl-6 pr-6 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Wyczyść"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
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
    </div>
  );
}
