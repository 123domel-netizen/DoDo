import { useEffect, useRef } from "react";
import { useStore } from "@/state/store";
import { isSharedItem, updateOwnParticipationReminders } from "@/lib/share";
import { hasActivePushSubscription, showLocalNotification } from "@/lib/push";
import {
  collectDueNotifications,
  loadFiredLog,
  saveFiredLog,
} from "@/lib/reminderScheduler";

/**
 * Local reminder scheduler. While the app (tab or installed PWA) is running it
 * checks reminders every 30s and fires a local notification when due.
 *
 * Gdy urządzenie ma aktywną subskrypcję Web Push i aplikacja jest w tle,
 * lokalne odpalanie jest pomijane — powiadomienie dosyła serwer (send-reminders).
 * Gdy PWA jest widoczna, lokalny tick działa mimo pusha (bezpiecznik gdy cron
 * milczy); dedupe po lokalnym firedLog ogranicza duble.
 */
export function useReminderScheduler() {
  const patchItem = useStore((s) => s.patchItem);
  const firedLogRef = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    const storage = typeof localStorage !== "undefined" ? localStorage : null;
    if (!firedLogRef.current) firedLogRef.current = loadFiredLog(storage);
    const firedLog = firedLogRef.current;

    const tick = async () => {
      const pushOn = await hasActivePushSubscription();
      const visible =
        typeof document === "undefined" || document.visibilityState === "visible";
      // Push + tło → serwer; push + widoczna app → lokalnie jako fallback.
      if (pushOn && !visible) return;

      const now = Date.now();
      const items = Object.values(useStore.getState().items);
      const due = collectDueNotifications(items, now, (key) => firedLog.has(key));
      if (!due.length) return;

      for (const n of due) {
        showLocalNotification(n.title, n.body, {
          tag: `reminder-${n.itemId}-${n.fireAt}`,
          url: `/#/wpis/${n.itemId}`,
        });
        firedLog.set(n.key, now);

        if (!n.markFiredReminderId) continue;
        const item = useStore.getState().items[n.itemId];
        if (!item) continue;
        const firedAtIso = new Date().toISOString();
        if (isSharedItem(item)) {
          const next = (item.personalReminders ?? []).map((x) =>
            x.id === n.markFiredReminderId ? { ...x, firedAt: firedAtIso } : x,
          );
          patchItem(item.id, { personalReminders: next });
          void updateOwnParticipationReminders(item.id, next);
        } else {
          patchItem(item.id, {
            reminders: item.reminders.map((x) =>
              x.id === n.markFiredReminderId ? { ...x, firedAt: firedAtIso } : x,
            ),
          });
        }
      }
      saveFiredLog(storage, firedLog, now);
    };

    void tick();
    const id = setInterval(() => void tick(), 30_000);
    return () => clearInterval(id);
  }, [patchItem]);
}
