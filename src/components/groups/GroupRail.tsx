import { useState, type CSSProperties } from "react";
import { Settings2, Plus } from "lucide-react";
import { useStore } from "@/state/store";
import {
  ARCHIVE_GROUP_NAME,
  findArchiveGroup,
  findShareGroup,
  sortGroupsForRail,
} from "@/lib/groups";
import { SHARE_GROUP_COLOR, SHARE_GROUP_NAME } from "@/lib/share";
import { GroupsModal } from "./GroupsModal";
import { AddGroupDialog } from "./AddGroupDialog";

const SYSTEM_ACCENT = "#737881";
/** Stała wysokość przycisków systemowych ALL / ARCH (oś pionowa paska). */
const SYSTEM_RAIL_H = "h-11 min-h-11 max-h-11";

function groupRailStyle(color: string, active: boolean): CSSProperties {
  if (active) {
    return {
      background: `linear-gradient(180deg, ${color}40 0%, ${color}28 100%)`,
      borderColor: `${color}55`,
      boxShadow: `inset 0 1px 0 ${color}30`,
    };
  }
  return {
    background: `${color}14`,
    borderColor: `${color}42`,
  };
}

function railLabelStyle(color: string, active: boolean): CSSProperties | undefined {
  if (active) return undefined;
  return { color: `${color}cc` };
}

function systemRailButtonClass(active: boolean): string {
  return `flex ${SYSTEM_RAIL_H} w-full flex-none items-center justify-center overflow-hidden rounded-lg border px-1 transition ${
    active ? "" : "border-dashed"
  }`;
}

function SystemRailButton({
  active,
  onClick,
  title,
  label,
  accent = SYSTEM_ACCENT,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={systemRailButtonClass(active)}
      style={groupRailStyle(accent, active)}
    >
      <span
        className={`vertical-text max-h-full truncate text-xs font-bold leading-none tracking-wider ${
          active ? "text-white/95" : ""
        }`}
        style={active ? undefined : railLabelStyle(accent, false)}
      >
        {label}
      </span>
    </button>
  );
}

function userRailButtonClass(active: boolean): string {
  return `flex min-h-0 flex-1 basis-0 items-center justify-center rounded-xl border px-1 transition ${
    active ? "" : "border-dashed hover:brightness-110"
  }`;
}

export function GroupRail() {
  const groups = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const setActiveGroupFilter = useStore((s) => s.setActiveGroupFilter);
  const addGroup = useStore((s) => s.addGroup);
  const [showManage, setShowManage] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);

  const userGroups = sortGroupsForRail(groups);
  const archive = findArchiveGroup(groups);
  const share = findShareGroup(groups);
  const allActive = activeGroupFilter === null;
  const archiveActive = archive ? activeGroupFilter === archive.id : false;
  const shareActive = share ? activeGroupFilter === share.id : false;

  return (
    <div className="flex h-full w-16 min-h-0 flex-col border-l border-line bg-surface py-2">
      <button
        onClick={() => setShowManage(true)}
        className="mx-auto mb-2 shrink-0 rounded-lg p-2 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
        title="Zarządzaj grupami"
      >
        <Settings2 size={17} />
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2">
        <SystemRailButton
          active={allActive}
          onClick={() => setActiveGroupFilter(null)}
          title="Wszystkie grupy"
          label="ALL"
        />

        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          {userGroups.map((g) => {
            const isActive = activeGroupFilter === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setActiveGroupFilter(g.id)}
                title={g.name}
                className={userRailButtonClass(isActive)}
                style={groupRailStyle(g.color, isActive)}
              >
                <span
                  className={`vertical-text max-h-full truncate text-[14px] font-semibold leading-none ${
                    isActive ? "text-white/95" : ""
                  }`}
                  style={isActive ? undefined : railLabelStyle(g.color, false)}
                >
                  {g.name}
                </span>
              </button>
            );
          })}

        </div>

        {share && (
          <SystemRailButton
            active={shareActive}
            onClick={() => setActiveGroupFilter(share.id)}
            title="Udostępnione Tobie"
            label={SHARE_GROUP_NAME}
            accent={SHARE_GROUP_COLOR}
          />
        )}

        {archive && (
          <SystemRailButton
            active={archiveActive}
            onClick={() => setActiveGroupFilter(archive.id)}
            title="Zarchiwizowane zadania"
            label={ARCHIVE_GROUP_NAME}
          />
        )}
      </div>

        <button
          onClick={() => setShowAddGroup(true)}
          className="mx-auto mt-2 shrink-0 rounded-lg p-2 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          title="Dodaj grupę"
          aria-label="Dodaj grupę"
          type="button"
        >
        <Plus size={17} />
      </button>

      <AddGroupDialog
        open={showAddGroup}
        onClose={() => setShowAddGroup(false)}
        onAdd={(name, color) => addGroup(name, color)}
        groupCount={groups.length}
      />
      <GroupsModal open={showManage} onClose={() => setShowManage(false)} />
    </div>
  );
}
