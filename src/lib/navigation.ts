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
 *
 * `setRouteHash` = replace (ten sam poziom).
 * `pushRouteHash` = pushState (zagnieżdżenie — systemowe wstecz działa).
 */

export type AppRoute =
  | { view: "chat" }
  | { view: "conversation"; conversationId: string; threadRootId?: string }
  | { view: "item"; itemId: string };

export type HistoryMode = "replace" | "push";

const APP_HISTORY = { dodo: true as const };

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
      return {
        view: "conversation",
        conversationId: parts[1],
        threadRootId: parts[3],
      };
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

function applyHash(route: AppRoute | null, mode: HistoryMode) {
  if (typeof window === "undefined") return;
  applyingHash = true;
  try {
    const next = route ? buildAppHash(route) : "";
    const url = `${window.location.pathname}${window.location.search}${next}`;
    if (mode === "push") {
      window.history.pushState({ ...APP_HISTORY }, "", url);
    } else {
      window.history.replaceState({ ...APP_HISTORY }, "", url);
    }
  } finally {
    applyingHash = false;
  }
}

/** Ustaw hash bez emitowania (nawigacja z UI, stan już zmieniony) — replace. */
export function setRouteHash(route: AppRoute | null) {
  applyHash(route, "replace");
}

/**
 * Push hash na stos historii (otwarcie rozmowy / wątku / zagnieżdżenia).
 * Systemowe wstecz / Android Back może wrócić do poprzedniego widoku.
 */
export function pushRouteHash(route: AppRoute) {
  applyHash(route, "push");
}

/** Nawigacja programowa (push click, chipy) — emituje do słuchaczy i ustawia hash. */
export function navigateTo(route: AppRoute, mode: HistoryMode = "replace") {
  applyHash(route, mode);
  emit(route);
}

export type MobileConversationReturn = "dashboard" | "chat";

let mobileConversationReturn: MobileConversationReturn | null = null;

/** Skąd wrócić po zamknięciu rozmowy na mobile (np. dashboard vs lista czatu). */
export function setMobileConversationReturn(
  target: MobileConversationReturn | null,
): void {
  mobileConversationReturn = target;
}

export function peekMobileConversationReturn(): MobileConversationReturn | null {
  return mobileConversationReturn;
}

export function consumeMobileConversationReturn(): MobileConversationReturn | null {
  const target = mobileConversationReturn;
  mobileConversationReturn = null;
  return target;
}

/** Preferuj history.back() gdy bieżący wpis jest app-owned (push/replace z dodo); inaczej callback. */
export function goBackOr(fallback: () => void) {
  if (typeof window === "undefined") {
    fallback();
    return;
  }
  const state = window.history.state as { dodo?: boolean } | null;
  if (window.history.length > 1 && state?.dodo) {
    window.history.back();
    return;
  }
  fallback();
}

/** Marker wpisu historii dla warstw UI (sheet/modal) bez zmiany URL. */
export const APP_LAYER_STATE = { dodo: true as const, layer: true as const };

/** Czy bieżący history.state należy do aplikacji (trasa lub warstwa). */
export function isAppHistoryState(state: unknown): state is { dodo: true } {
  return Boolean(
    state &&
      typeof state === "object" &&
      (state as { dodo?: boolean }).dodo === true,
  );
}

let navInitialized = false;

export function initNavigation() {
  if (navInitialized || typeof window === "undefined") return;
  navInitialized = true;

  const onHashOrPop = () => {
    if (applyingHash) return;
    emit(parseAppHash(window.location.hash));
  };

  window.addEventListener("hashchange", onHashOrPop);
  window.addEventListener("popstate", onHashOrPop);

  // Deep-link z service workera (kliknięcie w powiadomienie przy otwartej PWA).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type !== "navigate" || !data.url) return;
      const hashIdx = data.url.indexOf("#");
      if (hashIdx < 0) return;
      const route = parseAppHash(data.url.slice(hashIdx));
      if (route) navigateTo(route, "push");
    });
  }

  // Startowy hash (np. otwarcie z powiadomienia przy zamkniętej aplikacji).
  const initial = parseAppHash(window.location.hash);
  if (initial) {
    // Poczekaj aż aplikacja się zamontuje i zarejestruje słuchaczy.
    setTimeout(() => emit(initial), 0);
  }
}
