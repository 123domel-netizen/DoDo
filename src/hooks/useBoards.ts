import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { boardsBackendAvailable } from "@/lib/boards/api";
import { installBoardsRouteListener, startBoardsRuntime } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import { nextSnoozeWake } from "@/lib/boards/sections";
import type { BoardTopic } from "@/lib/boards/types";
import type { MainAreaMode } from "@/types";

/**
 * Tablice wymagają chmury, zalogowania i aktywnej organizacji — bez tego moduł
 * jest ukryty (jak Czat).
 */
export function useBoardsAvailable(): boolean {
  const authUserId = useStore((s) => s.authUserId);
  const orgId = useStore((s) => s.activeOrgId);
  return boardsBackendAvailable() && Boolean(authUserId) && Boolean(orgId);
}

/**
 * Tryb obszaru głównego z uwzględnieniem dostępności modułów.
 * Przegląd jest wycofany z belki — zapisane `dashboard` traktujemy jak Kalendarz.
 * Niedostępne Tablice też padają na Kalendarz (bez kasowania ustawienia).
 */
export function useEffectiveMainAreaMode(): MainAreaMode {
  const mode = useStore((s) => s.settings.mainAreaMode);
  const available = useBoardsAvailable();
  if (mode === "dashboard") return "calendar";
  if (mode === "boards" && !available) return "calendar";
  return mode;
}

/** Id tematu do pokazania w prawym panelu desktopu (tryb Tablice + wybrany temat), inaczej null. */
export function useBoardTopicInPanel(): string | null {
  const mode = useEffectiveMainAreaMode();
  const topicId = useBoardsStore((s) => s.activeTopicId);
  return mode === "boards" ? topicId : null;
}

/** Montowany raz w App: ładowanie, realtime i most z Czatem dla bieżącej organizacji. */
export function useBoardsLifecycle(): void {
  const authUserId = useStore((s) => s.authUserId);
  const orgId = useStore((s) => s.activeOrgId);
  const available = boardsBackendAvailable();

  useEffect(() => installBoardsRouteListener(), []);

  useEffect(() => {
    if (!available || !authUserId || !orgId) {
      useBoardsStore.getState().reset();
      return;
    }
    return startBoardsRuntime(authUserId, orgId);
  }, [available, authUserId, orgId]);
}

/**
 * Bieżący czas odświeżany w momencie, gdy któryś odłożony temat ma wrócić
 * (oraz po powrocie do karty) — lista przenosi go do „Tematy” bez przeładowania.
 */
export function useBoardsNow(topics: BoardTopic[]): Date {
  const [now, setNow] = useState(() => new Date());
  const wakeMs = useMemo(() => nextSnoozeWake(topics, new Date())?.getTime() ?? null, [topics]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (wakeMs !== null) {
      // setTimeout nie obsłuży > ~24 dni; wtedy i tak odświeżymy się przy powrocie do karty.
      const delay = Math.min(Math.max(wakeMs - Date.now() + 250, 250), 2_000_000_000);
      timer = setTimeout(tick, delay);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wakeMs]);

  return now;
}

/** Suma nieprzeczytanych komentarzy we wszystkich tablicach (znaczek w nawigacji). */
export function useBoardsUnreadTotal(): number {
  return useBoardsStore((s) => s.boards.reduce((n, b) => n + b.unreadCount, 0));
}
