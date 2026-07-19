import { useEffect } from "react";
import { useChatStore } from "@/lib/chat/store";

type HubTab = ReturnType<typeof useChatStore.getState>["hubTab"];

const TAB_BY_DIGIT: Record<string, HubTab> = {
  "1": "chat",
  "2": "decisions",
  "3": "notes",
  "4": "media",
  "5": "search",
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
 * Alt+1…5 — zakładki
 * Alt+E — cykl: normalny → powiększony → zwinięty → normalny
 */
export function useHubHotkeys(enabled: boolean) {
  const setHubTab = useChatStore((s) => s.setHubTab);
  const cycleHubLayout = useChatStore((s) => s.cycleHubLayout);
  const hubHiddenTabs = useChatStore((s) => s.hubHiddenTabs);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;

      const digit = e.key;
      if (digit in TAB_BY_DIGIT) {
        const tab = TAB_BY_DIGIT[digit];
        if (!tab || hubHiddenTabs.includes(tab)) return;
        e.preventDefault();
        setHubTab(tab);
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        cycleHubLayout();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, setHubTab, cycleHubLayout, hubHiddenTabs]);
}
