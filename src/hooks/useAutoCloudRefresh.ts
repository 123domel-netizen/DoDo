import { useEffect } from "react";
import { tryAutoCloudRefresh } from "@/lib/cloud";
import { cloudEnabled } from "@/lib/supabase";

const AUTO_PULL_INTERVAL_MS = 3 * 60_000;

/**
 * Bezpieczny auto-pull z chmury: powrót do aplikacji, focus i co ~3 min
 * (tylko gdy dokument widoczny i spełnione warunki w tryAutoCloudRefresh).
 */
export function useAutoCloudRefresh() {
  useEffect(() => {
    if (!cloudEnabled) return;

    const tryPull = () => {
      if (document.visibilityState !== "visible") return;
      void tryAutoCloudRefresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") tryPull();
    };

    const onFocus = () => tryPull();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const intervalId = window.setInterval(tryPull, AUTO_PULL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(intervalId);
    };
  }, []);
}
