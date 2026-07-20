import { isSameDay } from "date-fns";
import { Bell } from "lucide-react";
import type { Group, Item } from "@/types";
import type { ReminderMarker } from "@/lib/reminders";
import { markerAsTimedSlice } from "@/lib/reminders";
import { fmtTime, tint } from "@/lib/format";
import { placementForDay, timedGeometry, type DayPlacement } from "@/lib/time";
import type { DayColumnSlot } from "@/lib/weekend";

interface ReminderMarkersProps {
  markers: ReminderMarker[];
  day: Date;
  dayIndex: number;
  columnLayout: DayColumnSlot[];
  dayStartHour: number;
  dayEndHour: number;
  hourHeight: number;
  groups: Record<string, Group>;
  placement: DayPlacement;
  onOpen: (itemId: string) => void;
}

export function ReminderMarkers({
  markers,
  day,
  dayIndex,
  columnLayout,
  dayStartHour,
  dayEndHour,
  hourHeight,
  groups,
  placement,
  onOpen,
}: ReminderMarkersProps) {
  const slot = columnLayout[dayIndex];
  const dayMarkers = markers.filter((m) => isSameDay(m.at, day));

  return (
    <>
      {dayMarkers.map((marker) => {
        const slice = markerAsTimedSlice(marker);
        const probe: Item = { ...marker.item, ...slice };
        if (placementForDay(probe, day, dayStartHour, dayEndHour) !== placement) return null;

        const g = marker.item.groupId ? groups[marker.item.groupId] : undefined;
        const color = g?.color ?? "#C08F52";

        if (placement === "timed") {
          const geom = timedGeometry(probe, day, dayStartHour, dayEndHour, hourHeight);
          return (
            <button
              key={marker.key}
              type="button"
              onClick={() => onOpen(marker.item.id)}
              title={`${marker.item.title || "Zadanie"} · przypomnienie ${fmtTime(marker.at)}`}
              className="absolute z-20 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition hover:scale-110"
              style={{
                top: geom.topPx,
                left: `calc(${slot.leftPct}% + 2px)`,
                background: tint(color, 0.35),
                boxShadow: `0 0 0 1px ${tint(color, 0.6)}`,
              }}
            >
              <Bell size={12} className="text-amber-300" aria-hidden />
            </button>
          );
        }

        return (
          <button
            key={marker.key}
            type="button"
            onClick={() => onOpen(marker.item.id)}
            title={`${marker.item.title || "Zadanie"} · przypomnienie ${fmtTime(marker.at)}`}
            className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-amber-200"
            style={{ background: tint(color, 0.22) }}
          >
            <Bell size={10} aria-hidden />
            <span>{fmtTime(marker.at)}</span>
          </button>
        );
      })}
    </>
  );
}
