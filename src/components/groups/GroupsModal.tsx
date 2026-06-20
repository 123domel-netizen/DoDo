import { Modal } from "@/components/ui/Modal";
import { useStore } from "@/state/store";
import { GROUP_COLORS } from "@/lib/factory";
import { isArchiveGroup } from "@/lib/groups";
import { Plus, Trash2 } from "lucide-react";

export function GroupsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useStore((s) => s.groups);
  const patchGroup = useStore((s) => s.patchGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const addGroup = useStore((s) => s.addGroup);

  return (
    <Modal open={open} onClose={onClose} width={460}>
      <div className="p-5">
        <h2 className="mb-3 text-lg font-semibold">Grupy</h2>
        <div className="space-y-2">
          {groups.map((g) => {
            const locked = isArchiveGroup(g);
            return (
            <div key={g.id} className="flex items-center gap-2">
              <ColorPicker value={g.color} onChange={(color) => patchGroup(g.id, { color })} />
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
                onClick={() => {
                  if (confirm(`Usunąć grupę „${g.name}”? Elementy zostaną bez grupy.`))
                    deleteGroup(g.id);
                }}
                className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={15} />
              </button>
              )}
            </div>
            );
          })}
        </div>
        <button
          onClick={() => addGroup("Nowa grupa", GROUP_COLORS[groups.length % GROUP_COLORS.length])}
          className="mt-3 flex items-center gap-1 text-sm text-ink-light hover:text-ink"
        >
          <Plus size={15} /> Dodaj grupę
        </button>
      </div>
    </Modal>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-5 w-5 rounded-full" style={{ background: value }} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface-raised px-1.5 py-1.5 text-xs text-ink outline-none"
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
