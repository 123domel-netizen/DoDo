import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Sliders } from "lucide-react";
import type { Group } from "@/types";
import { ARCHIVE_GROUP_NAME } from "@/lib/groups";
import { SHARE_GROUP_COLOR } from "@/lib/share";
import { SYSTEM_GROUP_ICONS, defaultGroupIconForName } from "@/lib/groupIcons";
import { GroupIcon } from "@/components/groups/GroupIcon";

type Density = "full" | "icons" | "compact" | "mini";

const DENSITIES: Density[] = ["full", "icons", "compact", "mini"];
const CHIP_GAP = 4;

function chipStyle(color: string, active: boolean): CSSProperties {
  if (active) {
    return {
      background: `linear-gradient(180deg, ${color}40 0%, ${color}26 100%)`,
      borderColor: `${color}66`,
      color: "#fff",
    };
  }
  return { background: `${color}14`, borderColor: `${color}3a`, color: `${color}cc` };
}

type FilterChip = {
  key: string;
  label: string;
  color: string;
  filterId: string | null;
  icon: string;
  system?: boolean;
};

function chipMetrics(density: Density) {
  switch (density) {
    case "mini":
      return { size: 20, icon: 9, padX: 0 };
    case "compact":
      return { size: 24, icon: 11, padX: 0 };
    case "icons":
      return { size: 32, icon: 14, padX: 0 };
    default:
      return { size: 32, icon: 14, padX: 10 };
  }
}

function GroupFilterChip({
  label,
  color,
  icon,
  active,
  density,
  system,
  onClick,
}: {
  label: string;
  color: string;
  icon: string;
  active: boolean;
  density: Density;
  system?: boolean;
  onClick: () => void;
}) {
  const { size, icon: iconSize, padX } = chipMetrics(density);
  const iconOnly = system || density !== "full";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        ...chipStyle(color, active),
        height: size,
        ...(iconOnly
          ? { width: size }
          : { paddingLeft: padX, paddingRight: padX }),
      }}
      className={`flex shrink-0 items-center justify-center gap-1 rounded-full border transition ${
        iconOnly ? "" : "min-w-0"
      } ${active ? "" : "border-dashed"}`}
    >
      <GroupIcon name={icon} color={active ? "#fff" : color} size={iconSize} />
      {!iconOnly && (
        <span className="max-w-[5.5rem] truncate text-[10px] font-medium leading-none">
          {label}
        </span>
      )}
    </button>
  );
}

function rowWidth(widths: number[]): number {
  if (!widths.length) return 0;
  return widths.reduce((sum, w) => sum + w, 0) + (widths.length - 1) * CHIP_GAP;
}

export function GroupFilterBar({
  userGroups,
  share,
  archive,
  activeGroupFilter,
  onSelect,
  onManage,
}: {
  userGroups: Group[];
  share: Group | undefined;
  archive: Group | undefined;
  activeGroupFilter: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}) {
  const chips: FilterChip[] = useMemo(
    () => [
      {
        key: "all",
        label: "Wszystkie grupy",
        color: "#6A7280",
        filterId: null,
        icon: SYSTEM_GROUP_ICONS.all,
        system: true,
      },
      ...userGroups.map((g, i) => ({
        key: g.id,
        label: g.name,
        color: g.color,
        filterId: g.id,
        icon: g.icon ?? defaultGroupIconForName(g.name, i),
      })),
      ...(share
        ? [
            {
              key: share.id,
              label: "Udostępnione",
              color: SHARE_GROUP_COLOR,
              filterId: share.id,
              icon: SYSTEM_GROUP_ICONS.share,
              system: true,
            },
          ]
        : []),
      ...(archive
        ? [
            {
              key: archive.id,
              label: ARCHIVE_GROUP_NAME,
              color: archive.color,
              filterId: archive.id,
              icon: SYSTEM_GROUP_ICONS.archive,
              system: true,
            },
          ]
        : []),
    ],
    [userGroups, share, archive],
  );

  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<Density>("full");

  const chipKey = useMemo(
    () => chips.map((c) => `${c.key}:${c.label}`).join("|"),
    [chips],
  );

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    const recompute = () => {
      const avail = row.clientWidth;
      if (avail <= 0) return;

      for (const mode of DENSITIES) {
        const rowEl = measure.querySelector<HTMLElement>(`[data-density-row="${mode}"]`);
        if (!rowEl) continue;
        const els = rowEl.querySelectorAll<HTMLElement>("[data-chip-measure]");
        if (els.length !== chips.length) continue;
        const widths = Array.from(els).map((el) => el.offsetWidth);
        if (rowWidth(widths) <= avail) {
          setDensity(mode);
          return;
        }
      }
      setDensity("mini");
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [chips.length, chipKey]);

  return (
    <div className="relative border-b border-line px-3 py-1.5">
      <div className="flex items-center gap-1">
        <div
          ref={rowRef}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        >
          {chips.map((c) => (
            <GroupFilterChip
              key={c.key}
              label={c.label}
              color={c.color}
              icon={c.icon}
              density={density}
              system={c.system}
              active={activeGroupFilter === c.filterId}
              onClick={() => onSelect(c.filterId)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onManage}
          className="shrink-0 rounded-full border border-dashed border-line p-1.5 text-ink-faint transition hover:border-line-strong hover:text-ink"
          aria-label="Zarządzaj grupami"
        >
          <Sliders size={13} />
        </button>
      </div>

      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute left-0 top-0 px-3"
        aria-hidden
      >
        {DENSITIES.map((mode) => (
          <div key={mode} data-density-row={mode} className="flex gap-1">
            {chips.map((c) => (
              <span key={c.key} data-chip-measure className="inline-flex">
                <GroupFilterChip
                  label={c.label}
                  color={c.color}
                  icon={c.icon}
                  density={mode}
                  system={c.system}
                  active={false}
                  onClick={() => {}}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
