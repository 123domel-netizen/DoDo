import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { GROUP_ICON_OPTIONS, type GroupIconName } from "@/lib/groupIcons";
import { GroupIcon } from "@/components/groups/GroupIcon";

export function GroupIconPicker({
  open,
  value,
  color,
  onClose,
  onSelect,
}: {
  open: boolean;
  value?: string | null;
  color: string;
  onClose: () => void;
  onSelect: (icon: GroupIconName) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUP_ICON_OPTIONS;
    return GROUP_ICON_OPTIONS.filter((name) => name.toLowerCase().includes(q));
  }, [query]);

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div className="p-4">
        <h2 className="mb-3 text-lg font-semibold text-ink">Ikona grupy</h2>
        <div className="relative mb-3">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj ikony…"
            className="w-full rounded-lg border border-line bg-surface-raised py-2 pl-8 pr-3 text-sm text-ink outline-none focus:border-line-strong"
          />
        </div>
        <div className="grid max-h-[min(50vh,22rem)] grid-cols-6 gap-1.5 overflow-y-auto thin-scrollbar sm:grid-cols-8">
          {filtered.map((icon) => {
            const active = value === icon;
            return (
              <button
                key={icon}
                type="button"
                title={icon}
                onClick={() => {
                  onSelect(icon);
                  onClose();
                }}
                className={`flex aspect-square items-center justify-center rounded-lg border transition ${
                  active
                    ? "border-accent bg-accent/15"
                    : "border-line/60 bg-surface-raised/40 hover:border-line-strong hover:bg-surface-overlay"
                }`}
              >
                <GroupIcon name={icon} color={active ? color : "#9ca3af"} size={18} />
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-faint">Brak wyników</p>
        )}
      </div>
    </Modal>
  );
}
