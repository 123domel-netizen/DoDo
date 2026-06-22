import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/state/store";
import { TAG_COLORS } from "@/lib/tags";

export function TagsSettings() {
  const tags = useStore((s) => s.tags);
  const addTag = useStore((s) => s.addTag);
  const patchTag = useStore((s) => s.patchTag);
  const deleteTag = useStore((s) => s.deleteTag);
  const [draftName, setDraftName] = useState("");

  const list = Object.values(tags).sort((a, b) => a.name.localeCompare(b.name, "pl"));

  const submitNew = () => {
    const name = draftName.trim();
    if (!name) return;
    addTag(name);
    setDraftName("");
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Tagi</div>
      <p className="text-[11px] leading-snug text-ink-faint">
        Prywatne etykiety do oznaczania zadań i wydarzeń. Nie są współdzielone z uczestnikami SHARE.
      </p>

      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">Brak tagów</p>
      ) : (
        <ul className="space-y-2">
          {list.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 px-2 py-1.5"
            >
              <input
                type="color"
                value={tag.color}
                onChange={(e) => patchTag(tag.id, { color: e.target.value })}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label={`Kolor tagu ${tag.name}`}
              />
              <input
                value={tag.name}
                onChange={(e) => patchTag(tag.id, { name: e.target.value })}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => deleteTag(tag.id)}
                className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-surface-overlay hover:text-red-400"
                aria-label={`Usuń tag ${tag.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNew();
          }}
          placeholder="Nowy tag…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={submitNew}
          disabled={!draftName.trim()}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          <Plus size={14} /> Dodaj
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              if (draftName.trim()) addTag(draftName.trim(), c);
              else if (list.length) patchTag(list[list.length - 1]!.id, { color: c });
            }}
            className="h-5 w-5 rounded-full border border-line transition hover:scale-110"
            style={{ background: c }}
            title="Kolor szybkiego wyboru"
          />
        ))}
      </div>
    </div>
  );
}
