import { useEffect } from "react";
import { useChatStore } from "@/lib/chat/store";

type HubTab = ReturnType<typeof useChatStore.getState>["hubTab"];

const TAB_BY_DIGIT: Record<string, HubTab> = {
  "1": "today",
  "2": "chat",
  "3": "threads",
  "4": "decisions",
  "5": "notes",
  "6": "media",
  "7": "mentions",
  "8": "search",
  "9": "links",
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true']"));
}

/**
 * Skróty hubu (desktop):
 * Alt+1…9 — zakładki
 * Alt+E — rozwiń / zwiń hub
 */
export function useHubHotkeys(enabled: boolean) {
  const setHubTab = useChatStore((s) => s.setHubTab);
  const toggleHubExpanded = useChatStore((s) => s.toggleHubExpanded);
  const hubHiddenTabs = useChatStore((s) => s.hubHiddenTabs);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;

      const digit = e.key;
      if (digit in TAB_BY_DIGIT) {
        const tab = TAB_BY_DIGIT[digit];
        if (hubHiddenTabs.includes(tab)) return;
        e.preventDefault();
        setHubTab(tab);
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        toggleHubExpanded();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, setHubTab, toggleHubExpanded, hubHiddenTabs]);
}
