import { useCallback, useRef } from "react";

const SWIPE_BLOCK =
  'button,a,input,select,textarea,label,[contenteditable="true"],[data-no-swipe]';

function touchBlocked(clientX: number, clientY: number): boolean {
  const el = document.elementFromPoint(clientX, clientY);
  return Boolean(el?.closest(SWIPE_BLOCK));
}

export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  threshold = 60,
}: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  enabled?: boolean;
  threshold?: number;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const t = e.touches[0];
      if (!t || touchBlocked(t.clientX, t.clientY)) return;
      start.current = { x: t.clientX, y: t.clientY };
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !start.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = Math.abs(t.clientY - start.current.y);
      const dx = Math.abs(t.clientX - start.current.x);
      if (dy > threshold && dy > dx * 1.2) start.current = null;
    },
    [enabled, threshold],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !start.current) return;
      const t = e.changedTouches[0];
      if (!t) {
        start.current = null;
        return;
      }
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) <= Math.abs(dy)) return;
      if (dx < 0) onSwipeLeft();
      else onSwipeRight();
    },
    [enabled, threshold, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
