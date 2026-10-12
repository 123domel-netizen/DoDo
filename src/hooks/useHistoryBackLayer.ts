import { useEffect, useRef } from "react";
import {
  dismissHistoryLayer,
  noteHistoryLayerPopped,
  pushHistoryLayer,
} from "@/lib/historyBackLayer";

/**
 * Gdy `open` jest true, pushuje wpis historii bez zmiany URL.
 * Systemowe wstecz zamyka warstwę przez `onClose`; zamknięcie z UI zdejmuje wpis ze stosu.
 *
 * Bezpieczne przy przejściu A→B w jednym commicie (np. selektor wiadomości → edytor):
 * dismiss A nie zrobi history.back() jeśli B już jest na wierzchu.
 */
export function useHistoryBackLayer(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pushedRef = useRef(false);
  const layerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const layerId = pushHistoryLayer();
    layerIdRef.current = layerId;
    pushedRef.current = true;

    const onPop = () => {
      pushedRef.current = false;
      layerIdRef.current = null;
      noteHistoryLayerPopped(layerId);
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushedRef.current) {
        pushedRef.current = false;
        layerIdRef.current = null;
        dismissHistoryLayer(layerId);
      }
    };
  }, [open]);
}
