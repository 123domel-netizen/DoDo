import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useStore } from "@/state/store";
import type { UserTag } from "@/types";
import { resolveItemTags } from "@/lib/tags";

/** Edytor tagów użytkownika dla dowolnej listy id (nie tylko Item). */
export function TagIdsEditor({
  tagIds,
  onChange,
}: {
  tagIds: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const tags = useStore((s) => s.tags);
  const addTag = useStore((s) => s.addTag);
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const assigned = resolveItemTags(tagIds, tags);
  const allTags = Object.values(tags).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const available = allTags.filter((t) => !tagIds.includes(t.id));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewTagName("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (tagId: string) => {
    if (tagIds.includes(tagId)) {
      onChange(tagIds.filter((id) => id !== tagId));
    } else {
      onChange([...tagIds, tagId]);
    }
  };

  const createAndAssign = () => {
    const name = newTagName.trim();
    if (!name) return;
    const tag = addTag(name);
    onChange([...tagIds, tag.id]);
    setNewTagName("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.length === 0 ? (
        <span className="text-xs text-ink-faint">Brak tagów</span>
      ) : (
        assigned.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={() => toggle(tag.id)} />
        ))
      )}

      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-line px-2 py-0.5 text-[10px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <Plus size={12} />
          {allTags.length === 0 ? "Utwórz tag" : "Dodaj"}
        </button>

        {open && (
          <div className="absolute left-0 top-full z-40 mt-1 min-w-[11rem] max-w-[min(11rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface-overlay py-1 shadow-pop">
            {available.length > 0 ? (
              available.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    toggle(tag.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: tag.color }}
                  />
                  {tag.name}
                </button>
              ))
            ) : allTags.length > 0 ? (
              <p className="px-3 py-1.5 text-xs text-ink-faint">Wszystkie tagi przypisane</p>
            ) : null}
            <div className="border-t border-line px-2 py-2">
              <div className="flex gap-1">
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createAndAssign();
                  }}
                  placeholder="Nowy tag…"
                  className="min-w-0 flex-1 rounded border border-line bg-surface-raised px-2 py-1 text-xs text-ink outline-none"
                />
                <button
                  type="button"
                  onClick={createAndAssign}
                  disabled={!newTagName.trim()}
                  className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TagChip({ tag, onRemove }: { tag: UserTag; onRemove: () => void }) {
  return (
    <span
      className="inline-flex max-w-[8rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium text-ink"
      style={{ background: `${tag.color}22`, border: `1px solid ${tag.color}55` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tag.color }} />
      <span className="truncate">{tag.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-ink-faint hover:text-ink"
        aria-label={`Usuń tag ${tag.name}`}
      >
        <X size={11} />
      </button>
    </span>
  );
}
