import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "@/state/store";
import { sortGroupsForRail } from "@/lib/groups";
import { tint } from "@/lib/format";

const AUTO_HIDE_MS = 10_000;

export function GroupSelectPrompt() {
  const itemId = useStore((s) => s.groupPromptItemId);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);
  const patchItem = useStore((s) => s.patchItem);
  const dismissGroupPrompt = useStore((s) => s.dismissGroupPrompt);
  const clearGroupPrompt = useStore((s) => s.clearGroupPrompt);

  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = itemId ? items[itemId] : undefined;
  const userGroups = sortGroupsForRail(groups);

  useEffect(() => {
    if (!itemId || !item) return;
    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    timerRef.current = setTimeout(() => clearGroupPrompt(), AUTO_HIDE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [itemId, item, paused, clearGroupPrompt]);

  useEffect(() => {
    if (!itemId) setPaused(false);
  }, [itemId]);

  if (!itemId || !item || item.groupId || item.groupPromptDismissed) return null;

  const pick = (groupId: string) => {
    patchItem(item.id, { groupId });
    clearGroupPrompt();
  };

  const later = () => {
    dismissGroupPrompt(item.id);
    clearGroupPrompt();
  };

  return (
    <div
      className="pointer-events-auto fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,22rem)] rounded-xl border border-line bg-surface-overlay p-3 shadow-pop sm:bottom-6 sm:right-6"
      onMouseEnter={() => setPaused(true)}
      onMouseDown={() => setPaused(true)}
      onTouchStart={() => setPaused(true)}
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">Wybierz grupę</div>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
            Ten wpis nie ma jeszcze grupy.
          </p>
        </div>
        <button
          type="button"
          onClick={later}
          className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Zamknij"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {userGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => pick(g.id)}
            className="rounded-lg border px-2.5 py-1 text-xs font-medium text-ink transition hover:brightness-110"
            style={{
              background: tint(g.color, 0.2),
              borderColor: `${g.color}55`,
            }}
          >
            {g.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={later}
        className="mt-2 w-full rounded-lg py-1 text-[11px] text-ink-faint transition hover:text-ink"
      >
        Później
      </button>
    </div>
  );
}
