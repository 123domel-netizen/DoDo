import { useEffect, useState } from "react";

const STORAGE_PREFIX = "dodo-hide-thread-previews-v1:";

function storageKey(userId: string, conversationId: string): string {
  return `${STORAGE_PREFIX}${userId}:${conversationId}`;
}

/** Preferencja lokalna: ukryj bogaty podgląd wątków w głównej taśmie rozmowy. */
export function loadHideThreadPreviews(
  userId: string | null | undefined,
  conversationId: string,
): boolean {
  if (!userId || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(storageKey(userId, conversationId)) === "1";
  } catch {
    return false;
  }
}

export function saveHideThreadPreviews(
  userId: string | null | undefined,
  conversationId: string,
  hide: boolean,
): void {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    const key = storageKey(userId, conversationId);
    if (hide) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota */
  }
}

export function useHideThreadPreviews(
  userId: string | null | undefined,
  conversationId: string,
): [boolean, () => void] {
  const [hide, setHide] = useState(() => loadHideThreadPreviews(userId, conversationId));

  useEffect(() => {
    setHide(loadHideThreadPreviews(userId, conversationId));
  }, [userId, conversationId]);

  return [
    hide,
    () => {
      setHide((prev) => {
        const next = !prev;
        saveHideThreadPreviews(userId, conversationId, next);
        return next;
      });
    },
  ];
}
