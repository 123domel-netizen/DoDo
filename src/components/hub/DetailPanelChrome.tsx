import { type ReactNode } from "react";
import { ListTodo } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { overviewTitle } from "@/lib/chat/feed";
import { showTodoInPanel } from "@/lib/chat/init";

/** Pasek nawigacji nad detalem w prawym panelu: szybki powrót do zadań. */
export function DetailPanelChrome({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-raised/40 px-2 py-1">
        <button
          type="button"
          onClick={() => showTodoInPanel()}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink"
          title="Pokaż zadania (kontekst hubu zostaje)"
        >
          <ListTodo size={13} />
          Zadania
        </button>
        <span className="text-[10px] text-ink-faint">/</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
          {label}
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function useConversationDetailLabel(conversationId: string | null): string {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const items = useStore((s) => s.items);
  if (!conversationId) return "Rozmowa";
  const entry = overview.find((c) => c.id === conversationId);
  if (!entry) return "Rozmowa";
  return overviewTitle(entry, myUserId, (id) => items[id]?.title);
}
