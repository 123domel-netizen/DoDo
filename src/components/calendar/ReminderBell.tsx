import { Bell } from "lucide-react";
import type { Item } from "@/types";

export function ReminderBell({ item, size = 10 }: { item: Item; size?: number }) {
  if (item.reminders.length === 0) return null;
  return (
    <Bell
      size={size}
      className="shrink-0 text-amber-400/90"
      aria-label="Ma przypomnienie"
    />
  );
}
