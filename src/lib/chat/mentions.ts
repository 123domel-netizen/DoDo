/**
 * CHAT5-MENTIONS: wzmianki @Nazwa — czyste funkcje (autouzupełnianie + zbiórka
 * id przy wysyłce). Oznaczać można wyłącznie uczestników danej rozmowy.
 */

export interface MentionableMember {
  userId: string;
  displayName: string;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Id członków, których "@Nazwa" występuje w treści (case-insensitive,
 * granica słowa po nazwie). Wywoływane przy wysyłce — usunięcie tekstu
 * wzmianki naturalnie usuwa oznaczenie.
 */
export function collectMentions(body: string, members: MentionableMember[]): string[] {
  const lower = body.toLowerCase();
  const out: string[] = [];
  for (const member of members) {
    const name = member.displayName.trim();
    if (!name) continue;
    const token = `@${name.toLowerCase()}`;
    let idx = lower.indexOf(token);
    while (idx >= 0) {
      const after = body[idx + token.length];
      if (after === undefined || !WORD_CHAR.test(after)) {
        out.push(member.userId);
        break;
      }
      idx = lower.indexOf(token, idx + 1);
    }
  }
  return [...new Set(out)];
}

export interface MentionQuery {
  /** Pozycja znaku "@" w tekście. */
  start: number;
  /** Tekst pomiędzy "@" a kursorem. */
  query: string;
}

/**
 * Aktywne zapytanie wzmianki pod kursorem: ostatni "@" przed caretem,
 * poprzedzony początkiem tekstu/białym znakiem, bez nowej linii w środku,
 * maks. 30 znaków (nazwy mogą zawierać spacje).
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > 30 || query.includes("\n")) return null;
  return { start: at, query };
}

/** Podpowiedzi: członkowie rozmowy pasujący do zapytania (bez mnie). */
export function mentionSuggestions(
  members: MentionableMember[],
  query: string,
  excludeUserId: string | null,
): MentionableMember[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => m.userId !== excludeUserId && m.displayName.trim())
    .filter((m) => !q || m.displayName.toLowerCase().includes(q))
    .slice(0, 6);
}

/** Wstaw wybraną wzmiankę w miejsce zapytania; zwraca nowy tekst i caret. */
export function applyMention(
  text: string,
  caret: number,
  mention: MentionQuery,
  displayName: string,
): { text: string; caret: number } {
  const inserted = `@${displayName} `;
  const next = text.slice(0, mention.start) + inserted + text.slice(caret);
  return { text: next, caret: mention.start + inserted.length };
}

/** Czy wiadomość wzmiankuje danego użytkownika. */
export function mentionsUser(mentions: string[] | undefined, userId: string | null): boolean {
  return Boolean(userId && mentions && mentions.includes(userId));
}
