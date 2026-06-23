import { useEffect } from "react";
import { useStore } from "@/state/store";
import { isItemDeleted } from "@/lib/items";
import { effectiveReminders, reminderFireTimeMs } from "@/lib/reminders";
import { isSharedItem, updateOwnParticipationReminders } from "@/lib/share";
import { showLocalNotification } from "@/lib/push";
import { fmt, fmtTime } from "@/lib/format";

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
        if (isItemDeleted(item) || item.done) continue;
        const reminders = effectiveReminders(item);
        for (const r of reminders) {
          if (r.firedAt) continue;
          const fireAt = reminderFireTimeMs(item, r);
          if (fireAt === null) continue;
          if (fireAt <= now && now - fireAt < 5 * 60_000) {
            const when = r.remindAt
              ? fmt(new Date(r.remindAt), "d MMM, HH:mm")
              : fmtTime(item.start);
            showLocalNotification(
              item.title || "Wydarzenie",
              r.remindAt
                ? `Przypomnienie o ${when}`
                : `${item.type === "task" ? "Zadanie" : "Wydarzenie"} o ${when}`,
            );
            if (isSharedItem(item)) {
              const next = reminders.map((x) =>
                x.id === r.id ? { ...x, firedAt: new Date().toISOString() } : x,
              );
              patchItem(item.id, { personalReminders: next });
              void updateOwnParticipationReminders(item.id, next);
            } else {
              patchItem(item.id, {
                reminders: item.reminders.map((x) =>
                  x.id === r.id ? { ...x, firedAt: new Date().toISOString() } : x,
                ),
              });
            }
          }
        }
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [patchItem]);
}
