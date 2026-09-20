/**
 * Trwała kolejka wysyłki kalendarza (Sync v2).
 *
 * Wcześniej lista „co jeszcze nie poszło do chmury" żyła wyłącznie w pamięci,
 * a same wpisy były zapisywane w IndexedDB. Zamknięcie PWA w ciągu debounce'u
 * (800 ms) albo nieudany upsert powodowały więc trwały rozjazd: telefon
 * pokazywał wydarzenie z lokalnego cache'u, a laptop nigdy go nie zobaczył,
 * bo nic już nie wiedziało, że jest co wysłać.
 *
 * Kolejka jest trzymana per użytkownik — przełączenie konta nie może wysłać
 * cudzych zmian.
 */

import { get, set, del } from "idb-keyval";

const KEY_PREFIX = "dodo-sync-outbox-v1";

export interface PersistedOutbox {
  itemIds: string[];
  participantIds: string[];
  tagAssignmentsDirty: boolean;
}

export const EMPTY_OUTBOX: PersistedOutbox = {
  itemIds: [],
  participantIds: [],
  tagAssignmentsDirty: false,
};

export function outboxStorageKey(userId: string | null): string {
  return `${KEY_PREFIX}-${userId ?? "local"}`;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v === "string" && v) out.add(v);
  }
  return [...out];
}

/** Dane z IDB są nieufne — mogą pochodzić ze starszej wersji aplikacji. */
export function normalizePersistedOutbox(raw: unknown): PersistedOutbox {
  if (!raw || typeof raw !== "object") return EMPTY_OUTBOX;
  const o = raw as Record<string, unknown>;
  return {
    itemIds: uniqueStrings(o.itemIds),
    participantIds: uniqueStrings(o.participantIds),
    tagAssignmentsDirty: o.tagAssignmentsDirty === true,
  };
}

export function isEmptyOutbox(value: PersistedOutbox): boolean {
  return (
    value.itemIds.length === 0 &&
    value.participantIds.length === 0 &&
    !value.tagAssignmentsDirty
  );
}

export async function loadOutbox(userId: string | null): Promise<PersistedOutbox> {
  try {
    return normalizePersistedOutbox(await get(outboxStorageKey(userId)));
  } catch {
    return EMPTY_OUTBOX;
  }
}

export async function saveOutbox(
  userId: string | null,
  value: PersistedOutbox,
): Promise<void> {
  try {
    if (isEmptyOutbox(value)) {
      await del(outboxStorageKey(userId));
      return;
    }
    await set(outboxStorageKey(userId), value);
  } catch {
    /* brak miejsca / tryb prywatny — kolejka zostaje przynajmniej w RAM */
  }
}

export async function clearStoredOutbox(userId: string | null): Promise<void> {
  try {
    await del(outboxStorageKey(userId));
  } catch {
    /* ignore */
  }
}

/**
 * Wpisy obecne lokalnie, a nieobecne w chmurze — czyli takie, które nigdy nie
 * zostały wysłane. Usuwanie jest miękkie (tombstone zostaje wierszem), więc
 * brak wiersza nie oznacza „skasowane na innym urządzeniu".
 *
 * Rekoncyliacja po pullu jest ostatnią siatką bezpieczeństwa: łapie też wpisy,
 * które zgubiła kolejka sprzed wprowadzenia trwałości.
 */
export function itemIdsMissingInCloud(input: {
  localItems: Record<string, { shareRole?: string }>;
  remoteItemIds: Iterable<string>;
}): string[] {
  const remote = new Set(input.remoteItemIds);
  const missing: string[] = [];
  for (const [id, item] of Object.entries(input.localItems)) {
    // Wpisy współdzielone należą do innego właściciela — ich brak oznacza
    // cofnięcie udostępnienia, a nie zgubioną wysyłkę.
    if (item.shareRole === "participant") continue;
    if (!remote.has(id)) missing.push(id);
  }
  return missing;
}
