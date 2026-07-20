import { isSameDay } from "date-fns";
import { AlarmClock } from "lucide-react";
import type { Group, Item } from "@/types";
import type { DeadlineMarker } from "@/lib/deadlines";
import {
  deadlineIconDimmed,
  deadlineMarkerSlice,
  deadlineTooltipTitle,
} from "@/lib/deadlines";
import { fmtTime, tint } from "@/lib/format";
import { placementForDay, timedGeometry, type DayPlacement } from "@/lib/time";
import type { DayColumnSlot } from "@/lib/weekend";

interface DeadlineMarkersProps {
  markers: DeadlineMarker[];
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

export function DeadlineMarkers({
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
}: DeadlineMarkersProps) {
  const slot = columnLayout[dayIndex];
  const dayMarkers = markers.filter((m) => isSameDay(m.at, day));

  return (
    <>
      {dayMarkers.map((marker) => {
        const slice = deadlineMarkerSlice(marker.item.deadlineAt!);
        const probe: Item = { ...marker.item, ...slice };
        if (placementForDay(probe, day, dayStartHour, dayEndHour) !== placement) return null;

        const g = marker.item.groupId ? groups[marker.item.groupId] : undefined;
        const color = g?.color ?? "#C08F52";
        const dim = deadlineIconDimmed(marker.item);
        const title = deadlineTooltipTitle(marker.item);

        if (placement === "timed") {
          const geom = timedGeometry(probe, day, dayStartHour, dayEndHour, hourHeight);
          return (
            <button
              key={marker.key}
              type="button"
              onClick={() => onOpen(marker.item.id)}
              title={title}
              className={`absolute z-20 flex h-6 w-6 items-center justify-center rounded-full border border-red-500/40 bg-red-500/15 shadow-sm transition hover:scale-110 ${
                dim ? "opacity-50" : ""
              }`}
              style={{
                top: geom.topPx,
                left: `calc(${slot.leftPct}% + 2px)`,
              }}
            >
              <AlarmClock size={12} className="text-red-500" aria-hidden />
            </button>
          );
        }

        return (
          <button
            key={marker.key}
            type="button"
            onClick={() => onOpen(marker.item.id)}
            title={title}
            className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-red-400 ${
              dim ? "opacity-50" : ""
            }`}
            style={{ background: tint(color, 0.12) }}
          >
            <AlarmClock size={10} className="text-red-500" aria-hidden />
            <span>{fmtTime(marker.at)}</span>
          </button>
        );
      })}
    </>
  );
}
