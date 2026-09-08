import { useChatStore } from "@/lib/chat/store";
import {
  jumpToMessage,
  openConversation,
  showTodoInPanel,
} from "@/lib/chat/init";
import { TodoPanel } from "@/components/todo/TodoPanel";
import { ItemEditorPanel } from "@/components/item/ItemEditorPanel";
import { ConversationView } from "@/components/chat/ConversationView";
import { ConversationMediaView } from "@/components/chat/ConversationMediaView";
import { RegistryDetailPanel } from "@/components/hub/RegistryDetailPanel";
import { DetailPanelChrome } from "@/components/hub/DetailPanelChrome";
import { useStore } from "@/state/store";

/**
 * Prawy panel desktop: zadania / edytor / rozmowa / decyzja / notatka / media.
 * Priorytet: edytor wpisu > detal hubu > lista zadań.
 */
export function SidePanel() {
  const editingId = useStore((s) => s.editingId);
  const panelMode = useChatStore((s) => s.panelMode);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const mediaConversationId = useChatStore((s) => s.mediaConversationId);

  if (editingId) return <ItemEditorPanel />;

  if (panelMode === "media" && mediaConversationId) {
    return (
      <DetailPanelChrome>
        <ConversationMediaView
          embedded
          conversationId={mediaConversationId}
          onClose={() => showTodoInPanel()}
          onJumpTo={(messageId) => {
            void openConversation(mediaConversationId).then(() => {
              void jumpToMessage(mediaConversationId, messageId);
            });
          }}
        />
      </DetailPanelChrome>
    );
  }

  if (panelMode === "conversation" && activeConversationId) {
    return (
      <DetailPanelChrome>
        <ConversationView
          key={activeConversationId}
          conversationId={activeConversationId}
          onBack={() => showTodoInPanel()}
        />
      </DetailPanelChrome>
    );
  }

  if (panelMode === "decision" || panelMode === "note") {
    return (
      <DetailPanelChrome>
        <RegistryDetailPanel />
      </DetailPanelChrome>
    );
  }

  return <TodoPanel />;
}
