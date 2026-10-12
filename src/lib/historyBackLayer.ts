/**
 * Stack warstw UI (sheet/modal/selektor) na history API bez zmiany URL.
 *
 * Problem: zamknięcie warstwy A i otwarcie B w tym samym commicie Reacta
 * (np. clearSelection + startDraft) — cleanup A robi history.back(), a B
 * zdąży dodać listener popstate → back zamyka B zamiast A.
 *
 * Rozwiązanie: każda warstwa ma layerId; dismiss A jest odroczony (microtask)
 * i robi back tylko gdy A jest nadal na wierzchu. Jeśli B już wypchnęło
 * wpis, A trafia na listę porzuconych i jest pomijane przy kolejnym wstecz.
 */

import { APP_LAYER_STATE } from "@/lib/navigation";

export type HistoryLayerState = typeof APP_LAYER_STATE & { layerId: number };

let nextLayerId = 1;
const abandonedLayerIds = new Set<number>();
let globalListening = false;

export function resetHistoryBackLayerForTests() {
  nextLayerId = 1;
  abandonedLayerIds.clear();
  globalListening = false;
}

export function isHistoryLayerState(state: unknown): state is HistoryLayerState {
  return Boolean(
    state &&
      typeof state === "object" &&
      (state as { dodo?: boolean }).dodo === true &&
      (state as { layer?: boolean }).layer === true &&
      typeof (state as { layerId?: unknown }).layerId === "number",
  );
}

/** Czy po zamknięciu warstwy wolno od razu zrobić history.back()? */
export function dismissActionForLayer(
  currentState: unknown,
  layerId: number,
): "back" | "abandon" {
  if (isHistoryLayerState(currentState) && currentState.layerId === layerId) {
    return "back";
  }
  return "abandon";
}

function skipAbandonedIfNeeded() {
  if (typeof window === "undefined") return;
  const state = window.history.state;
  if (!isHistoryLayerState(state) || !abandonedLayerIds.has(state.layerId)) return;
  abandonedLayerIds.delete(state.layerId);
  window.history.back();
}

function ensureGlobalAbandonedSkip() {
  if (globalListening || typeof window === "undefined") return;
  globalListening = true;
  window.addEventListener("popstate", skipAbandonedIfNeeded);
}

export function pushHistoryLayer(): number {
  ensureGlobalAbandonedSkip();
  const layerId = nextLayerId++;
  const state: HistoryLayerState = { ...APP_LAYER_STATE, layerId };
  window.history.pushState(state, "", window.location.href);
  return layerId;
}

/**
 * Programatyczne zdjęcie warstwy (cleanup efektu gdy open→false).
 * Microtask: inne warstwy z tego samego commita zdążą zrobić push.
 */
export function dismissHistoryLayer(layerId: number) {
  if (typeof window === "undefined") return;
  queueMicrotask(() => {
    if (dismissActionForLayer(window.history.state, layerId) === "back") {
      window.history.back();
      return;
    }
    abandonedLayerIds.add(layerId);
  });
}

/** Warstwa zamknięta przez popstate — nie jest już „nasza”. */
export function noteHistoryLayerPopped(layerId: number) {
  abandonedLayerIds.delete(layerId);
}
