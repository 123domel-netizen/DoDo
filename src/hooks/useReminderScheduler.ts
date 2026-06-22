import { useEffect } from "react";
import { useStore } from "@/state/store";
import { isItemDeleted } from "@/lib/items";
import { showLocalNotification } from "@/lib/push";
import { fmtTime } from "@/lib/format";

/**
 * Local reminder scheduler. While the app (tab or installed PWA) is running it
 * checks reminders every 30s and fires a local notification when due. The
 * server-side Edge Function handles delivery when the app is closed.
 */
export function useReminderScheduler() {
  const patchItem = useStore((s) => s.patchItem);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const items = Object.values(useStore.getState().items);
      for (const item of items) {
        if (isItemDeleted(item) || item.done || !item.hasDueDate) continue;
        const start = new Date(item.start).getTime();
        for (const r of item.reminders) {
          if (r.firedAt) continue;
          const fireAt = start - r.offsetMinutes * 60_000;
          if (fireAt <= now && now - fireAt < 5 * 60_000) {
            showLocalNotification(
              item.title || "Wydarzenie",
              `${item.type === "task" ? "Zadanie" : "Wydarzenie"} o ${fmtTime(item.start)}`,
            );
            patchItem(item.id, {
              reminders: item.reminders.map((x) =>
                x.id === r.id ? { ...x, firedAt: new Date().toISOString() } : x,
              ),
            });
          }
        }
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [patchItem]);
}
