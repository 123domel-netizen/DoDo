import { parseChecklistPaste } from "@/lib/checklistPaste";
import { checklistLinesFromBody } from "@/lib/chat/convertDraft";
import type { ChatMessage } from "@/lib/chat/types";

export type MessageSelectMode = "whole" | "split";

/** Skrót treści jako pojedynczy punkt checklisty. */
export function wholePointFromMessage(msg: ChatMessage): string {
  if (msg.kind === "checklist") {
    const title = msg.body.trim().split("\n")[0]?.trim() || "Checklista";
    return title.slice(0, 200);
  }
  if (msg.kind === "voice") return "🎤 Wiadomość głosowa";
  if (msg.kind === "gif") return "GIF";
  if (msg.kind === "gallery") return `🖼 Galeria: ${msg.body || "…"}`.slice(0, 200);
  if (msg.kind === "poll") return (msg.body.trim() || "Ankieta").slice(0, 200);
  const text = msg.body.trim();
  if (!text) return "(załącznik)";
  return text.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Punkty checklisty z jednej zaznaczonej wiadomości.
 * whole = jeden punkt; split = rozbicie (payload / parseChecklistPaste).
 */
export function pointsFromSelectedMessage(
  msg: ChatMessage,
  mode: MessageSelectMode,
): string[] {
  if (mode === "whole") {
    return [wholePointFromMessage(msg)];
  }

  if (msg.kind === "checklist") {
    const items = msg.payload?.checklist?.items ?? [];
    const fromPayload = items
      .map((it) => it.text.trim())
      .filter(Boolean)
      .map((t) => t.slice(0, 200));
    if (fromPayload.length) return fromPayload;
  }

  const pasted = parseChecklistPaste(msg.body);
  if (pasted.length > 1) return pasted.map((t) => t.slice(0, 200));

  const lines = checklistLinesFromBody(msg.body);
  if (lines.length > 1) return lines.map((t) => t.slice(0, 200));

  if (pasted.length === 1) return [pasted[0]!.slice(0, 200)];
  return [wholePointFromMessage(msg)];
}

/** Spłaszczona lista punktów w kolejności zaznaczeń. */
export function pointsFromSelection(
  entries: { msg: ChatMessage; mode: MessageSelectMode }[],
): string[] {
  const out: string[] = [];
  for (const { msg, mode } of entries) {
    out.push(...pointsFromSelectedMessage(msg, mode));
  }
  return out;
}
