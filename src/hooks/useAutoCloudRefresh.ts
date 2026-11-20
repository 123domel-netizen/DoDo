import { useEffect } from "react";
import { tryAutoCloudRefresh } from "@/lib/cloud";
import {
  AUTO_PULL_INTERVAL_MS,
  FOCUS_VISIBILITY_DEBOUNCE_MS,
  type CloudPullSource,
} from "@/lib/cloudPullGate";
import { cloudEnabled } from "@/lib/supabase";

/**
 * Jedna instalacja listenerów na proces (refcount).
 * Chroni przed StrictMode i przypadkowym drugim mountem App.
 */
let installCount = 0;
let sharedDispose: (() => void) | null = null;

function installAutoCloudRefreshListeners(): () => void {
  let debounceTimer: number | null = null;

  const clearDebounce = () => {
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runIfVisible = (source: CloudPullSource) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    void tryAutoCloudRefresh(source);
  };

  /** Focus i visibility → jedna zaplanowana próba (nie dwa równoległe pulle). */
  const scheduleFocusVisibilityPull = (source: "auto-focus" | "auto-visibility") => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    clearDebounce();
    // window.* — spójne z intervalem i łatwe do mockowania w testach.
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      runIfVisible(source);
    }, FOCUS_VISIBILITY_DEBOUNCE_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      scheduleFocusVisibilityPull("auto-visibility");
    }
  };

  const onFocus = () => {
    scheduleFocusVisibilityPull("auto-focus");
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  const intervalId = window.setInterval(() => {
    runIfVisible("auto-interval");
  }, AUTO_PULL_INTERVAL_MS);

  return () => {
    clearDebounce();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    window.clearInterval(intervalId);
  };
}

/**
 * Subskrypcja auto-pulla (refcount). Używane przez hook i testy.
 * Gdy `cloudEnabled` jest false (DEMO / brak env) — no-op, zero zapytań.
 */
export function subscribeAutoCloudRefresh(): () => void {
  if (!cloudEnabled) return () => {};

  installCount += 1;
  if (installCount === 1) {
    sharedDispose = installAutoCloudRefreshListeners();
  }

  return () => {
    installCount = Math.max(0, installCount - 1);
    if (installCount === 0 && sharedDispose) {
      sharedDispose();
      sharedDispose = null;
    }
  };
}

/**
 * Bezpieczny auto-pull z chmury:
 * - interwał 60 min,
 * - focus/visibility tylko gdy snapshot > 60 min lub Realtime wymaga catch-up,
 * - wspólny debounce 5 s dla focus + visibilitychange,
 * - cross-tab leadership (Web Locks) + single-flight w cloudPullGate.
 */
export function useAutoCloudRefresh() {
  useEffect(() => subscribeAutoCloudRefresh(), []);
}

/** Reset stanu instalacji — tylko testy. */
export function resetAutoCloudRefreshInstallForTests(): void {
  installCount = 0;
  if (sharedDispose) {
    sharedDispose();
    sharedDispose = null;
  }
}

export function getAutoCloudRefreshInstallCountForTests(): number {
  return installCount;
}
