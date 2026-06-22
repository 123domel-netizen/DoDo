import { Bell } from "lucide-react";
import type { Item } from "@/types";
import { isOccurrenceId } from "@/lib/itemId";
import { effectiveReminders } from "@/lib/reminders";

export function ReminderBell({ item, size = 10 }: { item: Item; size?: number }) {
  // Przypomnienia są na itemie bazowym; wystąpienia powtarzalne nie mają osobnych triggerów.
  if (isOccurrenceId(item.id)) return null;
  if (effectiveReminders(item).length === 0) return null;
  return (
    <Bell
      size={size}
      className="shrink-0 text-amber-400/90"
      aria-label="Ma przypomnienie"
    />
  );
}
