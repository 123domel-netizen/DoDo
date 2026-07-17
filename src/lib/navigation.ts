/**
 * Mini hash-router (CHAT1-NAV). Aplikacja nie ma routera, a czat wymaga
 * deep-linków: push → konkretna rozmowa, chip „→ zadanie" → edytor, itd.
 *
 * Format:
 *   #/czat                      lista rozmów
 *   #/czat/{conversationId}     rozmowa
 *   #/czat/{cid}/watek/{mid}    wątek
 *   #/wpis/{itemId}             edytor itemu
 *
 * Hashe nie zaczynające się od "#/" (np. #error=... z OAuth) są ignorowane.
 */

export type AppRoute =
  | { view: "chat" }
  | { view: "conversation"; conversationId: string; threadRootId?: string }
  | { view: "item"; itemId: string };

export function parseAppHash(hash: string): AppRoute | null {
  if (!hash.startsWith("#/")) return null;
  const parts = hash
    .slice(2)
    .split("/")
    .map((p) => decodeURIComponent(p))
    .filter(Boolean);
  if (parts[0] === "czat") {
    if (!parts[1]) return { view: "chat" };
    if (parts[2] === "watek" && parts[3]) {
      return { view: "conversation", conversationId: parts[1], threadRootId: parts[3] };
    }
    return { view: "conversation", conversationId: parts[1] };
  }
  if (parts[0] === "wpis" && parts[1]) {
    return { view: "item", itemId: parts[1] };
  }
  return null;
}

export function buildAppHash(route: AppRoute): string {
  switch (route.view) {
    case "chat":
      return "#/czat";
    case "conversation":
      return route.threadRootId
        ? `#/czat/${route.conversationId}/watek/${route.threadRootId}`
        : `#/czat/${route.conversationId}`;
    case "item":
      return `#/wpis/${route.itemId}`;
  }
}

type RouteListener = (route: AppRoute) => void;
const listeners = new Set<RouteListener>();
let applyingHash = false;

export function onRouteChange(fn: RouteListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(route: AppRoute | null) {
  if (!route) return;
  for (const fn of listeners) fn(route);
}

/** Ustaw hash bez emitowania (nawigacja zainicjowana przez UI, stan już zmieniony). */
export function setRouteHash(route: AppRoute | null) {
  if (typeof window === "undefined") return;
  applyingHash = true;
  try {
    const next = route ? buildAppHash(route) : "";
    const url = `${window.location.pathname}${window.location.search}${next}`;
    window.history.replaceState({}, "", url);
  } finally {
    applyingHash = false;
  }
}

/** Nawigacja programowa (push click, chipy) — emituje do słuchaczy i ustawia hash. */
export function navigateTo(route: AppRoute) {
  setRouteHash(route);
  emit(route);
}

let navInitialized = false;

export function initNavigation() {
  if (navInitialized || typeof window === "undefined") return;
  navInitialized = true;

  window.addEventListener("hashchange", () => {
    if (applyingHash) return;
    emit(parseAppHash(window.location.hash));
  });

  // Deep-link z service workera (kliknięcie w powiadomienie przy otwartej PWA).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type !== "navigate" || !data.url) return;
      const hashIdx = data.url.indexOf("#");
      if (hashIdx < 0) return;
      const route = parseAppHash(data.url.slice(hashIdx));
      if (route) navigateTo(route);
    });
  }

  // Startowy hash (np. otwarcie z powiadomienia przy zamkniętej aplikacji).
  const initial = parseAppHash(window.location.hash);
  if (initial) {
    // Poczekaj aż aplikacja się zamontuje i zarejestruje słuchaczy.
    setTimeout(() => emit(initial), 0);
  }
}
