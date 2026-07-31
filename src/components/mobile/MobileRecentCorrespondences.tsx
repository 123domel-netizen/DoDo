import { useMemo } from "react";
import { MessageCircle, User, Users } from "lucide-react";
import { useStore } from "@/state/store";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { openConversation } from "@/lib/chat/init";
import { setRouteHash } from "@/lib/navigation";
import type { ChatOverviewEntry } from "@/lib/chat/types";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { dmPeerMember } from "@/lib/avatar";
import { overviewTitle } from "@/lib/chat/feed";

const MAX_AVATARS = 5;
const AVATAR = 40;

function shortLabel(title: string): string {
  const t = title.trim();
  if (!t) return "…";
  // Kanały często zaczynają się od # — zostaw znak.
  if (t.length <= 9) return t;
  return `${t.slice(0, 8)}…`;
}

/**
 * Pasek awatarów ostatnich korespondencji — nad dolnymi belkami mobilnymi.
 */
export function MobileRecentCorrespondences() {
  const myUserId = useChatStore((s) => s.userId);
  const overviewAll = useChatStore((s) => s.overview);
  const overview = useMemo(
    () => overviewAll.filter((c) => !c.myArchivedAt),
    [overviewAll],
  );
  const profiles = useChatStore((s) => s.profiles);
  const itemsMap = useStore((s) => s.items);

  const rows = useMemo(() => {
    const byRecent = [...overview].sort((a, b) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
    );
    const unread = byRecent.filter((c) => c.unreadCount > 0 || c.myMarkedUnread);
    const seen = new Set(unread.map((c) => c.id));
    const result: ChatOverviewEntry[] = [...unread];
    for (const c of byRecent) {
      if (result.length >= MAX_AVATARS) break;
      if (seen.has(c.id)) continue;
      result.push(c);
      seen.add(c.id);
    }
    return result.slice(0, MAX_AVATARS);
  }, [overview]);

  if (!cloudEnabled || !myUserId || rows.length === 0) return null;

  const open = (id: string) => {
    void openConversation(id);
    setRouteHash({ view: "conversation", conversationId: id });
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface-raised/80 px-2 pt-2 pb-1.5">
      <div
        className="mx-auto flex max-w-md items-start justify-evenly gap-1"
        role="list"
        aria-label="Ostatnie korespondencje"
      >
        {rows.map((entry) => {
          const showUnread = entry.unreadCount > 0 || entry.myMarkedUnread;
          const peer = dmPeerMember(entry.members, myUserId, entry.kind);
          const peerAvatar = peer
            ? (profiles[peer.userId]?.avatarUrl ?? peer.avatarUrl)
            : null;
          const title = overviewTitle(entry, myUserId, (id) => itemsMap[id]?.title);

          return (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              onClick={() => open(entry.id)}
              className="flex w-[4.25rem] flex-col items-center gap-1 rounded-lg px-0.5 py-0.5 transition active:scale-[0.97] active:bg-surface-overlay/60"
            >
              <span className="relative inline-flex shrink-0">
                <span
                  className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-surface-overlay transition ${
                    showUnread
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-raised"
                      : "ring-1 ring-line"
                  }`}
                >
                  {entry.kind === "channel" ? (
                    <ChannelIcon
                      iconUrl={entry.iconUrl}
                      size={entry.iconUrl ? AVATAR : 18}
                    />
                  ) : entry.kind === "item" ? (
                    <MessageCircle size={18} className="text-ink-faint" />
                  ) : entry.members.length > 2 ? (
                    <Users size={18} className="text-ink-faint" />
                  ) : peer ? (
                    <PersonAvatar
                      userId={peer.userId}
                      avatarUrl={peerAvatar}
                      size={AVATAR}
                      className="border-0"
                    />
                  ) : (
                    <User size={18} className="text-ink-faint" />
                  )}
                </span>
                {showUnread ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-white shadow-sm">
                    {entry.unreadCount > 0
                      ? entry.unreadCount > 9
                        ? "9+"
                        : entry.unreadCount
                      : ""}
                    {entry.unreadCount === 0 && entry.myMarkedUnread ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span
                className={`w-full truncate text-center text-[10px] leading-tight ${
                  showUnread ? "font-semibold text-ink" : "font-medium text-ink-faint"
                }`}
              >
                {shortLabel(title)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
