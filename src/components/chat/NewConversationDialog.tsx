import { useState } from "react";
import { Hash, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useChatStore } from "@/lib/chat/store";
import { createChannel, openConversation, startDm } from "@/lib/chat/init";

interface NewConversationDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewConversationDialog({ open, onClose }: NewConversationDialogProps) {
  const profiles = useChatStore((s) => s.profiles);
  const myUserId = useChatStore((s) => s.userId);

  const [mode, setMode] = useState<"dm" | "channel">("dm");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channelName, setChannelName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = Object.values(profiles)
    .filter((p) => p.userId !== myUserId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pl"));

  const toggle = (userId: string) => {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelected(next);
  };

  const reset = () => {
    setSelected(new Set());
    setChannelName("");
    setIsPublic(false);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (mode === "dm" && selected.size === 0) {
      setError("Wybierz przynajmniej jedną osobę.");
      return;
    }
    if (mode === "channel" && !channelName.trim()) {
      setError("Podaj nazwę kanału.");
      return;
    }
    setBusy(true);
    try {
      const id =
        mode === "dm"
          ? await startDm([...selected])
          : await createChannel(channelName.trim(), isPublic, [...selected]);
      if (!id) {
        setError("Nie udało się utworzyć rozmowy.");
        return;
      }
      reset();
      onClose();
      void openConversation(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div className="p-4">
        <div className="mb-3 text-sm font-semibold text-ink">Nowa rozmowa</div>

        <div className="mb-3 flex gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
          <button
            type="button"
            onClick={() => setMode("dm")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "dm" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
            }`}
          >
            <User size={13} /> Wiadomość
          </button>
          <button
            type="button"
            onClick={() => setMode("channel")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "channel" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
            }`}
          >
            <Hash size={13} /> Kanał
          </button>
        </div>

        {mode === "channel" && (
          <div className="mb-3 space-y-2">
            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Nazwa kanału (np. Dom, Budowa)"
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
            />
            <label className="flex items-center gap-2 text-xs text-ink-light">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="accent-[#5E7FA8]"
              />
              Kanał publiczny — widoczny dla wszystkich, każdy może dołączyć
            </label>
          </div>
        )}

        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          {mode === "dm" ? "Do kogo?" : "Członkowie (opcjonalnie)"}
        </div>
        <div className="thin-scrollbar mb-3 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface-raised/50">
          {people.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-ink-faint">
              Brak innych użytkowników. Zaproś osoby w Ustawienia → Kontakty.
            </div>
          )}
          {people.map((p) => (
            <label
              key={p.userId}
              className="flex cursor-pointer items-center gap-2.5 border-b border-line/50 px-3 py-2 last:border-b-0 hover:bg-surface-raised"
            >
              <input
                type="checkbox"
                checked={selected.has(p.userId)}
                onChange={() => toggle(p.userId)}
                className="accent-[#5E7FA8]"
              />
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt=""
                  className="h-6 w-6 rounded-full border border-line object-cover"
                />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-overlay text-[10px] text-ink-faint">
                  {p.displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {p.displayName || "Bez nazwy"}
              </span>
            </label>
          ))}
        </div>

        {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:border-line-strong hover:text-ink"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-accent-grad px-4 py-1.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
          >
            {mode === "dm" ? "Rozpocznij" : "Utwórz kanał"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
