import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import {
  ensureItemConversation,
  fetchItemConversationId,
  fetchItemLinks,
  type ItemSourceLink,
} from "@/lib/chat/api";
import {
  loadConversationMessages,
  markRead,
  scheduleOverviewRefresh,
  sendChatMessage,
  sendChatMessageWithFiles,
} from "@/lib/chat/init";
import { navigateTo } from "@/lib/navigation";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageComposer } from "@/components/chat/MessageComposer";

/**
 * CHAT2-ITEM: dyskusja przy zadaniu/wydarzeniu — osadzony wątek kind='item'.
 * Rozmowa tworzy się LENIWIE przy pierwszym komentarzu (ensure_item_conversation).
 */
export function ItemDiscussion({ itemId }: { itemId: string }) {
  const closeEditor = useStore((s) => s.closeEditor);
  const userId = useChatStore((s) => s.userId);
  // undefined = sprawdzanie; null = brak rozmowy (jeszcze); string = istnieje
  const [convId, setConvId] = useState<string | null | undefined>(undefined);
  const [sourceLinks, setSourceLinks] = useState<ItemSourceLink[]>([]);

  useEffect(() => {
    let live = true;
    setConvId(undefined);
    void fetchItemConversationId(itemId).then((id) => {
      if (!live) return;
      setConvId(id);
      if (id) {
        void loadConversationMessages(id);
        markRead(id);
      }
    });
    void fetchItemLinks(itemId).then((links) => {
      if (live) setSourceLinks(links.filter((l) => l.kind === "created_from"));
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  if (!userId) {
    return (
      <div className="px-1 py-2 text-xs text-ink-faint">
        Dyskusja wymaga zalogowania.
      </div>
    );
  }

  const startConversationAndSend = async (body: string, files: File[]) => {
    const { id, error } = await ensureItemConversation(itemId);
    if (error || !id) {
      alert(error ?? "Nie udało się utworzyć dyskusji.");
      return;
    }
    setConvId(id);
    if (files.length > 0) {
      const res = await sendChatMessageWithFiles({ conversationId: id, body, files });
      if (res.error) alert(res.error);
    } else if (body.trim()) {
      sendChatMessage({ conversationId: id, body });
    }
    scheduleOverviewRefresh(300);
  };

  const goToSource = (link: ItemSourceLink) => {
    closeEditor();
    navigateTo({ view: "conversation", conversationId: link.conversationId });
  };

  return (
    <div className="space-y-2">
      {sourceLinks.length > 0 && (
        <button
          type="button"
          onClick={() => goToSource(sourceLinks[0])}
          className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-ink transition hover:bg-accent/20"
        >
          <MessageSquare size={13} />
          Powstało z wiadomości — zobacz rozmowę
        </button>
      )}

      {convId === undefined ? (
        <div className="px-1 py-2 text-xs text-ink-faint">Ładowanie dyskusji…</div>
      ) : convId === null ? (
        <div className="overflow-hidden rounded-lg border border-line bg-surface-raised/40">
          <div className="px-3 pt-2 text-xs text-ink-faint">
            Brak komentarzy. Napisz pierwszy — dyskusję zobaczą uczestnicy wpisu.
          </div>
          <MessageComposer
            onSend={startConversationAndSend}
            placeholder="Skomentuj…"
            allowFiles
          />
        </div>
      ) : (
        <div className="flex h-80 flex-col overflow-hidden rounded-lg border border-line bg-surface-raised/40">
          <ConversationView conversationId={convId} embedded />
        </div>
      )}
    </div>
  );
}
