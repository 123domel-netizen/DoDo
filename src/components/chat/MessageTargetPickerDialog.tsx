import { useEffect, useMemo, useState } from "react";
import { Forward, MoveRight, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { useChatStore } from "@/lib/chat/store";
import { useStore } from "@/state/store";
import { overviewTitle } from "@/lib/chat/feed";
import { dmPeerMember } from "@/lib/avatar";
import type { ChatMessage, ChatOverviewEntry } from "@/lib/chat/types";

export type MessageTargetMode = "forward" | "move";

interface MessageTargetPickerDialogProps {
  open: boolean;
  mode: MessageTargetMode;
  msg: ChatMessage;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onPick: (conversationId: string) => void;
}

/** Po otwarciu z long-press — chwilowa blokada, żeby „odklejenie” palca nie wybrało rozmowy. */
const ARM_MS = 450;

function entryMatchesAuthor(entry: ChatOverviewEntry, authorUserId: string): boolean {
  return entry.members.some((m) => m.userId === authorUserId);
}

export function MessageTargetPickerDialog({
  open,
  mode,
  msg,
  busy = false,
  error = null,
  onClose,
  onPick,
}: MessageTargetPickerDialogProps) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const items = useStore((s) => s.items);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSelectedId(null);
    setArmed(false);
    const t = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(t);
  }, [open, msg.id, mode]);

  const itemTitleLookup = (itemId: string) => items[itemId]?.title;

  const candidates = useMemo(() => {
    const sourceId = msg.conversationId;
    const authorId = msg.authorUserId;
    return overview
      .filter((e) => {
        if (e.id === sourceId) return false;
        if (e.myArchivedAt) return false;
        if (mode === "move" && !entryMatchesAuthor(e, authorId)) return false;
        return true;
      })
      .map((e) => ({
        entry: e,
        title: overviewTitle(e, myUserId, itemTitleLookup),
      }))
      .sort((a, b) => {
        const ta = a.entry.lastMessageAt ?? a.entry.createdAt;
        const tb = b.entry.lastMessageAt ?? b.entry.createdAt;
        return tb.localeCompare(ta);
      });
  }, [overview, msg.conversationId, msg.authorUserId, mode, myUserId, items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((c) => c.title.toLowerCase().includes(needle));
  }, [candidates, q]);

  const selected = filtered.find((c) => c.entry.id === selectedId) ?? null;

  const heading = mode === "forward" ? "Przekaż wiadomość" : "Przenieś wiadomość";
  const hint =
    mode === "forward"
      ? "Wybierz rozmowę, potem potwierdź. Wiadomość pojawi się od Ciebie z oznaczeniem „Przesłano dalej”."
      : "Wybierz rozmowę, potem potwierdź. Tylko rozmowy, w których jesteś Ty (autor). Voice i załączniki przenoszą się razem.";
  const confirmLabel = mode === "forward" ? "Przekaż" : "Przenieś";

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} width={400}>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          {mode === "forward" ? (
            <Forward size={16} className="text-accent" />
          ) : (
            <MoveRight size={16} className="text-accent" />
          )}
          {heading}
        </div>
        <p className="mb-3 text-[11px] leading-snug text-ink-faint">{hint}</p>

        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelectedId(null);
            }}
            placeholder="Szukaj rozmowy…"
            disabled={busy}
            className="w-full rounded-lg border border-line bg-surface-raised py-2.5 pl-8 pr-3 text-sm text-ink outline-none focus:border-accent"
            autoFocus
          />
        </div>

        <div
          className={`max-h-[min(48vh,320px)] space-y-1 overflow-y-auto rounded-lg border border-line/70 bg-surface-raised/40 p-1.5 transition-opacity ${
            armed ? "opacity-100" : "opacity-70"
          }`}
          aria-disabled={!armed}
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-ink-faint">
              {mode === "move"
                ? "Brak rozmów, w których jesteś członkiem."
                : "Brak innych rozmów."}
            </p>
          ) : (
            filtered.map(({ entry, title }) => {
              const peer =
                entry.kind === "dm"
                  ? dmPeerMember(entry.members, myUserId, entry.kind)
                  : null;
              const isSelected = selectedId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={busy || !armed}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (!armed || busy) return;
                    setSelectedId(entry.id);
                  }}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition disabled:opacity-50 ${
                    isSelected
                      ? "bg-accent/15 ring-1 ring-accent/50"
                      : "hover:bg-ink/5 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {entry.kind === "dm" && peer ? (
                    <PersonAvatar
                      userId={peer.userId}
                      avatarUrl={peer.avatarUrl}
                      size={36}
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink-faint">
                      <ChannelIcon
                        iconUrl={entry.iconUrl}
                        size={entry.iconUrl ? 36 : 16}
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {title}
                    </span>
                    <span className="block text-[11px] text-ink-faint">
                      {entry.kind === "channel"
                        ? entry.isPublic
                          ? "Kanał publiczny"
                          : "Kanał"
                        : entry.kind === "item"
                          ? "Dyskusja wpisu"
                          : "Wiadomość bezpośrednia"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        {selected && !busy ? (
          <p className="mt-2 truncate text-center text-[12px] text-ink-light">
            Cel: <span className="font-medium text-ink">{selected.title}</span>
          </p>
        ) : null}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-11 flex-1 rounded-xl border border-line px-3 text-sm font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            disabled={busy || !armed || !selected}
            onClick={() => {
              if (!selected || busy || !armed) return;
              onPick(selected.entry.id);
            }}
            className="min-h-11 flex-[1.2] rounded-xl bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Przetwarzanie…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
