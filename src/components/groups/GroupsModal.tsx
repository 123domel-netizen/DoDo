import { Modal } from "@/components/ui/Modal";
import { useStore } from "@/state/store";
import { GROUP_COLORS } from "@/lib/factory";
import { findArchiveGroup, isArchiveGroup, sortGroupsForRail } from "@/lib/groups";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

export function GroupsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useStore((s) => s.groups);
  const patchGroup = useStore((s) => s.patchGroup);
  const moveGroup = useStore((s) => s.moveGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const addGroup = useStore((s) => s.addGroup);

  const userGroups = sortGroupsForRail(groups);
  const archive = findArchiveGroup(groups);
  const displayGroups = archive ? [...userGroups, archive] : userGroups;

  return (
    <Modal open={open} onClose={onClose} width={460}>
      <div className="p-5">
        <h2 className="mb-1 text-lg font-semibold">Grupy</h2>
        <p className="mb-3 text-[11px] text-ink-faint">
          Kolejność na pionowym pasku po prawej — strzałkami góra/dół.
        </p>
        <div className="space-y-2">
          {displayGroups.map((g) => {
            const locked = isArchiveGroup(g);
            const userIndex = userGroups.findIndex((u) => u.id === g.id);
            const canMoveUp = !locked && userIndex > 0;
            const canMoveDown = !locked && userIndex >= 0 && userIndex < userGroups.length - 1;

            return (
              <div key={g.id} className="flex items-center gap-1.5">
                {!locked ? (
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      disabled={!canMoveUp}
                      onClick={() => moveGroup(g.id, "up")}
                      className="rounded p-0.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink disabled:opacity-25"
                      aria-label={`Przesuń „${g.name}” wyżej`}
                      title="Wyżej"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveDown}
                      onClick={() => moveGroup(g.id, "down")}
                      className="rounded p-0.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink disabled:opacity-25"
                      aria-label={`Przesuń „${g.name}” niżej`}
                      title="Niżej"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="w-[22px] shrink-0" aria-hidden />
                )}

                <ColorPicker
                  value={g.color}
                  onChange={(color) => patchGroup(g.id, { color })}
                  disabled={locked}
                />
                <input
                  value={g.name}
                  readOnly={locked}
                  onChange={(e) => patchGroup(g.id, { name: e.target.value })}
                  className={`flex-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none focus:border-line-strong ${
                    locked ? "cursor-default opacity-80" : ""
                  }`}
                />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Usunąć grupę „${g.name}”? Elementy zostaną bez grupy.`))
                        deleteGroup(g.id);
                    }}
                    className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
                    aria-label={`Usuń grupę „${g.name}”`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => addGroup("Nowa grupa", GROUP_COLORS[groups.length % GROUP_COLORS.length])}
          className="mt-3 flex items-center gap-1 text-sm text-ink-light hover:text-ink"
        >
          <Plus size={15} /> Dodaj grupę
        </button>
      </div>
    </Modal>
  );
}

function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (c: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-5 w-5 rounded-full" style={{ background: value }} />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface-raised px-1.5 py-1.5 text-xs text-ink outline-none disabled:opacity-80"
        style={{ width: 100 }}
      >
        {GROUP_COLORS.map((c) => (
          <option key={c} value={c}>
            {colorName(c)}
          </option>
        ))}
      </select>
    </div>
  );
}

function colorName(hex: string): string {
  const names: Record<string, string> = {
    "#5e7fa8": "Błękit",
    "#6b9080": "Szałwia",
    "#9a8574": "Piaskowy",
    "#7d6b8c": "Figa",
    "#6a8f9b": "Stal",
    "#8a7b68": "Brąz",
    "#857a9e": "Lawenda",
    "#737881": "Grafit",
  };
  return names[hex.toLowerCase()] ?? hex;
}
