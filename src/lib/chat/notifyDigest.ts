/**
 * Bufor treści do lokalnych powiadomień czatu — jak Messenger:
 * przy 2+ wiadomościach w tej samej rozmowie pokaż liczbę + linie od najnowszej.
 */

export interface ChatNotifyDigest {
  title: string;
  /** Od najnowszej do starszej (max 5). */
  lines: string[];
  count: number;
}

const digests = new Map<string, ChatNotifyDigest>();

export function pushChatNotifyDigest(
  conversationId: string,
  title: string,
  line: string,
): ChatNotifyDigest {
  const prev = digests.get(conversationId);
  const lines = [line, ...(prev?.lines ?? [])].slice(0, 5);
  const next: ChatNotifyDigest = {
    title,
    lines,
    count: (prev?.count ?? 0) + 1,
  };
  digests.set(conversationId, next);
  return next;
}

export function clearChatNotifyDigest(conversationId: string) {
  digests.delete(conversationId);
}

export function formatChatNotifyDigest(d: ChatNotifyDigest): {
  title: string;
  body: string;
} {
  if (d.count <= 1) {
    return { title: d.title, body: d.lines[0] ?? "Nowa wiadomość" };
  }
  const title = `${d.title} · ${d.count}`;
  const body = [`${d.count} nowe wiadomości`, ...d.lines].join("\n");
  return { title, body };
}
