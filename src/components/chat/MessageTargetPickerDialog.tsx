import { useMemo, useState } from "react";
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

  const heading = mode === "forward" ? "Przekaż wiadomość" : "Przenieś wiadomość";
  const hint =
    mode === "forward"
      ? "Wiadomość pojawi się od Ciebie z oznaczeniem „Przesłano dalej”."
      : "Tylko rozmowy, w których jesteś Ty (autor). Voice i załączniki przenoszą się razem.";

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
            onChange={(e) => setQ(e.target.value)}
            placeholder="Szukaj rozmowy…"
            disabled={busy}
            className="w-full rounded-lg border border-line bg-surface-raised py-2 pl-8 pr-3 text-sm text-ink outline-none focus:border-accent"
            autoFocus
          />
        </div>

        <div className="max-h-[min(52vh,360px)] space-y-0.5 overflow-y-auto rounded-lg border border-line/70 bg-surface-raised/40 p-1">
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
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(entry.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition hover:bg-ink/5 disabled:opacity-50 dark:hover:bg-white/[0.06]"
                >
                  {entry.kind === "dm" && peer ? (
                    <PersonAvatar
                      userId={peer.userId}
                      avatarUrl={peer.avatarUrl}
                      size={32}
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink-faint">
                      <ChannelIcon iconUrl={entry.iconUrl} size={entry.iconUrl ? 32 : 16} />
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
        {busy && (
          <p className="mt-2 text-center text-[11px] text-ink-faint">Przetwarzanie…</p>
        )}
      </div>
    </Modal>
  );
}
