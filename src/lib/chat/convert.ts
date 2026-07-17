import type { Item } from "@/types";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { addDecision, createItemLink } from "@/lib/chat/api";
import { sendChatMessage } from "@/lib/chat/init";
import { draftFromMessage, type ConvertTarget } from "@/lib/chat/convertDraft";
import type { ChatMessage } from "@/lib/chat/types";

/**
 * CHAT2-LINK: wiadomość → zadanie / wydarzenie.
 * Otwiera istniejący edytor jako draft z prefill; po zatwierdzeniu draftu
 * tworzy link zwrotny (message_item_links) i wpis systemowy w rozmowie.
 */

export type { ConvertTarget } from "@/lib/chat/convertDraft";

interface PendingConversion {
  messageId: string;
  conversationId: string;
  itemId: string;
  target: ConvertTarget;
}

let pending: PendingConversion | null = null;
let unsubscribe: (() => void) | null = null;

async function finalizeConversion(p: PendingConversion, item: Item) {
  const userId = useChatStore.getState().userId;
  if (!userId) return;

  const { error } = await createItemLink(p.messageId, item.id, "created_from", userId);
  if (error) {
    console.warn("[chat] item link failed:", error);
    return;
  }
  useChatStore
    .getState()
    .linkToMessage(p.messageId, { itemId: item.id, kind: "created_from" });

  const label =
    p.target === "task"
      ? "Utworzono zadanie"
      : p.target === "checklist"
        ? "Utworzono checklistę"
        : "Utworzono wydarzenie";
  sendChatMessage({
    conversationId: p.conversationId,
    body: `${label}: ${item.title || "(bez tytułu)"}`,
    kind: "system",
  });
}

function clearPending() {
  pending = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Wiadomość → decyzja: wpis w rejestrze ustaleń rozmowy + notka systemowa.
 * (Decyzja nie jest itemem — żyje przy rozmowie, buduje historię ustaleń.)
 */
export async function saveMessageAsDecision(
  msg: ChatMessage,
): Promise<{ error?: string }> {
  const userId = useChatStore.getState().userId;
  if (!userId) return { error: "Brak zalogowanego użytkownika." };
  const body = msg.body.trim();
  if (!body) return { error: "Pusta wiadomość nie może być decyzją." };

  const { error } = await addDecision({
    conversationId: msg.conversationId,
    messageId: msg.id,
    body,
    createdBy: userId,
  });
  if (error) return { error };

  sendChatMessage({
    conversationId: msg.conversationId,
    body: `📌 Zapisano decyzję: ${body.slice(0, 140)}`,
    kind: "system",
  });
  return {};
}

/**
 * Start konwersji: otwiera draft w edytorze i czeka na commit.
 * Draft porzucony (discard) → konwersja po cichu anulowana.
 */
export function beginConvertMessageToItem(msg: ChatMessage, target: ConvertTarget) {
  const chat = useChatStore.getState();
  const author = chat.profiles[msg.authorUserId]?.displayName || "uczestnika rozmowy";

  const store = useStore.getState();
  store.startDraft(draftFromMessage(msg, target, author));
  const draft = useStore.getState().draft;
  if (!draft) return;

  clearPending();
  pending = {
    messageId: msg.id,
    conversationId: msg.conversationId,
    itemId: draft.id,
    target,
  };

  unsubscribe = useStore.subscribe((s) => {
    if (!pending) return;
    const committed = s.items[pending.itemId];
    if (committed) {
      const p = pending;
      clearPending();
      void finalizeConversion(p, committed);
      return;
    }
    // Draft zniknął bez commitu (discard / zamknięcie) → anuluj.
    const draftGone = !s.draft || s.draft.id !== pending.itemId;
    if (draftGone && s.editingId !== pending.itemId) {
      clearPending();
    }
  });
}
