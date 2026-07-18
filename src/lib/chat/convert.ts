import type { Item } from "@/types";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { addDecision, addNote, createItemLink } from "@/lib/chat/api";
import { sendChatMessage } from "@/lib/chat/init";
import { draftFromMessage, type ConvertTarget } from "@/lib/chat/convertDraft";
import type { ChatDecision, ChatMessage, ChatNote } from "@/lib/chat/types";

/**
 * CHAT2-LINK / CHAT6: wymienność obiektów — wiadomość / notatka / decyzja
 * → zadanie / wydarzenie / checklista (draft w edytorze z prefill) oraz
 * wiadomość → notatka/decyzja i notatka ↔ decyzja.
 * Po zatwierdzeniu draftu: link zwrotny (message_item_links) + wpis systemowy.
 */

export type { ConvertTarget } from "@/lib/chat/convertDraft";

/** Źródło konwersji: wiadomość albo wpis rejestru (notatka/decyzja). */
export interface ConvertSource {
  body: string;
  conversationId: string;
  /** Wiadomość źródłowa (link zwrotny); null np. dla notatki bez wiadomości. */
  messageId: string | null;
  authorName: string;
}

interface PendingConversion {
  messageId: string | null;
  conversationId: string;
  itemId: string;
  target: ConvertTarget;
}

let pending: PendingConversion | null = null;
let unsubscribe: (() => void) | null = null;

async function finalizeConversion(p: PendingConversion, item: Item) {
  const userId = useChatStore.getState().userId;
  if (!userId) return;

  if (p.messageId) {
    const { error } = await createItemLink(p.messageId, item.id, "created_from", userId);
    if (error) {
      console.warn("[chat] item link failed:", error);
      return;
    }
    useChatStore
      .getState()
      .linkToMessage(p.messageId, { itemId: item.id, kind: "created_from" });
  }

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
  return saveTextAsDecision(msg.conversationId, msg.body, msg.id);
}

export async function saveTextAsDecision(
  conversationId: string,
  text: string,
  messageId: string | null,
): Promise<{ error?: string }> {
  const userId = useChatStore.getState().userId;
  if (!userId) return { error: "Brak zalogowanego użytkownika." };
  const body = text.trim();
  if (!body) return { error: "Pusta treść nie może być decyzją." };

  const { error } = await addDecision({ conversationId, messageId, body, createdBy: userId });
  if (error) return { error };

  sendChatMessage({
    conversationId,
    body: `📌 Zapisano decyzję: ${body.slice(0, 140)}`,
    kind: "system",
  });
  return {};
}

/** Wiadomość → notatka (rejestr notatek rozmowy). */
export async function saveMessageAsNote(msg: ChatMessage): Promise<{ error?: string }> {
  return saveTextAsNote(msg.conversationId, msg.body, msg.id);
}

export async function saveTextAsNote(
  conversationId: string,
  text: string,
  messageId: string | null,
): Promise<{ error?: string }> {
  const userId = useChatStore.getState().userId;
  if (!userId) return { error: "Brak zalogowanego użytkownika." };
  const body = text.trim();
  if (!body) return { error: "Pusta treść nie może być notatką." };

  const { error } = await addNote({ conversationId, messageId, body, createdBy: userId });
  if (error) return { error };

  sendChatMessage({
    conversationId,
    body: `📝 Zapisano notatkę: ${body.slice(0, 140)}`,
    kind: "system",
  });
  return {};
}

/** Notatka → decyzja (zachowuje link do wiadomości źródłowej, jeśli był). */
export async function noteToDecision(note: ChatNote): Promise<{ error?: string }> {
  return saveTextAsDecision(note.conversationId, note.body, note.messageId);
}

/** Decyzja → notatka. */
export async function decisionToNote(decision: ChatDecision): Promise<{ error?: string }> {
  return saveTextAsNote(decision.conversationId, decision.body, decision.messageId);
}

/**
 * Start konwersji na item: otwiera draft w edytorze i czeka na commit.
 * Draft porzucony (discard) → konwersja po cichu anulowana.
 */
export function beginConvertToItem(source: ConvertSource, target: ConvertTarget) {
  const store = useStore.getState();
  store.startDraft(draftFromMessage({ body: source.body }, target, source.authorName));
  const draft = useStore.getState().draft;
  if (!draft) return;

  clearPending();
  pending = {
    messageId: source.messageId,
    conversationId: source.conversationId,
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

export function beginConvertMessageToItem(msg: ChatMessage, target: ConvertTarget) {
  const chat = useChatStore.getState();
  const author = chat.profiles[msg.authorUserId]?.displayName || "uczestnika rozmowy";
  beginConvertToItem(
    {
      body: msg.body,
      conversationId: msg.conversationId,
      messageId: msg.id,
      authorName: author,
    },
    target,
  );
}
