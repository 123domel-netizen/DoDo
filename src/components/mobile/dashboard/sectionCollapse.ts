import { useEffect, useState } from "react";

const STORAGE_PREFIX = "dodo-mobile-dash-section-v1:";

export function useMobileSectionExpanded(
  sectionId: string,
  defaultExpanded: boolean,
): [boolean, () => void] {
  const key = `${STORAGE_PREFIX}${sectionId}`;
  const [expanded, setExpanded] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      /* ignore */
    }
    return defaultExpanded;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [key, expanded]);

  return [expanded, () => setExpanded((v) => !v)];
}
