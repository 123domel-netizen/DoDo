import { useEffect, useRef } from "react";
import { APP_LAYER_STATE } from "@/lib/navigation";

/**
 * Gdy `open` jest true, pushuje wpis historii bez zmiany URL.
 * Systemowe wstecz zamyka warstwę przez `onClose`; zamknięcie z UI zdejmuje wpis ze stosu.
 */
export function useHistoryBackLayer(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    window.history.pushState(APP_LAYER_STATE, "", window.location.href);
    pushedRef.current = true;

    const onPop = () => {
      pushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [open]);
}
