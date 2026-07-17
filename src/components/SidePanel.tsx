import { lazy, Suspense } from "react";
import { ListChecks, MessageCircle } from "lucide-react";
import { useStore } from "@/state/store";
import { TodoPanel } from "@/components/todo/TodoPanel";
import { ItemEditorPanel } from "@/components/item/ItemEditorPanel";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { totalUnread } from "@/lib/chat/feed";

const ChatPanel = lazy(() =>
  import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

export function SidePanel() {
  const editingId = useStore((s) => s.editingId);
  const panelMode = useChatStore((s) => s.panelMode);
  const setPanelMode = useChatStore((s) => s.setPanelMode);
  const chatUnread = useChatStore((s) => (cloudEnabled ? totalUnread(s.overview) : 0));

  // Edytor zawsze wygrywa (dotychczasowe zachowanie).
  if (editingId) return <ItemEditorPanel />;
  if (!cloudEnabled) return <TodoPanel />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        <button
          type="button"
          onClick={() => setPanelMode("todo")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            panelMode === "todo"
              ? "bg-accent/15 text-ink"
              : "text-ink-light hover:bg-surface-raised hover:text-ink"
          }`}
        >
          <ListChecks size={14} /> Zadania
        </button>
        <button
          type="button"
          onClick={() => setPanelMode("chat")}
          className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            panelMode === "chat"
              ? "bg-accent/15 text-ink"
              : "text-ink-light hover:bg-surface-raised hover:text-ink"
          }`}
        >
          <MessageCircle size={14} /> Czat
          {chatUnread > 0 && (
            <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {chatUnread > 99 ? "99+" : chatUnread}
            </span>
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {panelMode === "chat" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                Ładowanie czatu…
              </div>
            }
          >
            <ChatPanel />
          </Suspense>
        ) : (
          <TodoPanel />
        )}
      </div>
    </div>
  );
}
