import type { ChatMessage } from "@/lib/chat/types";

/** Tekst jednej wiadomości do schowka (bez plików — tylko wzmianka o załącznikach). */
export function plainTextFromMessage(msg: ChatMessage): string {
  if (msg.deletedAt) return "Wiadomość usunięta";

  const parts: string[] = [];

  if (msg.kind === "voice") {
    parts.push("🎤 Wiadomość głosowa");
  } else if (msg.kind === "gif") {
    parts.push(msg.body.trim() ? `GIF: ${msg.body.trim()}` : "GIF");
  } else if (msg.kind === "gallery") {
    parts.push(`🖼 Galeria: ${msg.body.trim() || "…"}`);
  } else if (msg.kind === "poll") {
    parts.push(msg.body.trim() || "Ankieta");
    const opts = msg.payload?.poll?.options ?? [];
    for (const o of opts) {
      if (o.label.trim()) parts.push(`- ${o.label.trim()}`);
    }
  } else if (msg.kind === "checklist") {
    if (msg.body.trim()) parts.push(msg.body.trim());
    const items = msg.payload?.checklist?.items ?? [];
    for (const it of items) {
      const mark = it.done ? "[x]" : "[ ]";
      parts.push(`${mark} ${it.text.trim() || "…"}`);
    }
  } else if (msg.body.trim()) {
    parts.push(msg.body.trim());
  }

  for (const a of msg.attachments ?? []) {
    const name = a.fileName?.trim() || "załącznik";
    parts.push(`[załącznik: ${name}]`);
  }

  if (!parts.length) return "(pusta wiadomość)";
  return parts.join("\n");
}

/**
 * Skopiuj treść zaznaczonych wiadomości.
 * Kolejność: data wysłania (`createdAt`), nie kolejność zaznaczenia.
 */
export function plainTextFromSelectedMessages(messages: ChatMessage[]): string {
  const sorted = [...messages].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  return sorted
    .map((m) => plainTextFromMessage(m))
    .filter(Boolean)
    .join("\n\n");
}
