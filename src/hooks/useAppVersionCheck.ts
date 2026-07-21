import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIENT_BUILD_VERSION,
  dismissedUpdatePromptThisSession,
  fetchLatestAppRelease,
  isClientVersionStale,
  type AppReleaseInfo,
} from "@/lib/appVersion";
import { cloudEnabled } from "@/lib/supabase";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function useAppVersionCheck(enabled: boolean) {
  const [stale, setStale] = useState(false);
  const [release, setRelease] = useState<AppReleaseInfo | null>(null);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (!enabled || !cloudEnabled || checking.current) return;
    if (dismissedUpdatePromptThisSession()) {
      setStale(false);
      return;
    }
    checking.current = true;
    try {
      const latest = await fetchLatestAppRelease();
      if (!latest) return;
      setRelease(latest);
      setStale(isClientVersionStale(CLIENT_BUILD_VERSION, latest.version));
    } finally {
      checking.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !cloudEnabled) return;
    void check();
    const id = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, check]);

  const dismiss = useCallback(() => {
    setStale(false);
  }, []);

  return {
    stale,
    release,
    clientVersion: CLIENT_BUILD_VERSION,
    dismiss,
    recheck: check,
  };
}
