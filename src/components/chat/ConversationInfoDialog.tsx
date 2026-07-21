import { Hash, MessageSquare, User, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { dmPeerMember } from "@/lib/avatar";
import { isOnline } from "@/lib/chat/presence";
import type { ChatOverviewEntry, ChatProfile } from "@/lib/chat/types";

interface ConversationInfoDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ChatOverviewEntry;
  title: string;
  myUserId: string | null;
  profiles: Record<string, ChatProfile>;
  /** Dla adminów kanału — otwórz zarządzanie. */
  onManage?: () => void;
  canManage?: boolean;
}

const AVATAR = 72;

export function ConversationInfoDialog({
  open,
  onClose,
  entry,
  title,
  myUserId,
  profiles,
  onManage,
  canManage = false,
}: ConversationInfoDialogProps) {
  const dmOther = dmPeerMember(entry.members, myUserId, entry.kind);
  const dmOnline = Boolean(dmOther && isOnline(profiles[dmOther.userId]?.lastSeenAt));
  const members = [...entry.members].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "pl"),
  );

  const kindLabel =
    entry.kind === "channel"
      ? entry.isPublic
        ? "Kanał publiczny"
        : "Kanał prywatny"
      : entry.kind === "item"
        ? "Dyskusja wpisu"
        : entry.members.length > 2
          ? "Rozmowa grupowa"
          : "Wiadomość bezpośrednia";

  return (
    <Modal open={open} onClose={onClose} width={360}>
      <div className="px-5 pb-5 pt-6">
        <div className="flex flex-col items-center text-center">
          <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full border border-line bg-surface-raised text-ink-faint shadow-card">
            {entry.kind === "channel" ? (
              entry.iconUrl ? (
                <ChannelIcon iconUrl={entry.iconUrl} size={AVATAR} />
              ) : (
                <Hash size={28} />
              )
            ) : entry.kind === "dm" ? (
              entry.members.length > 2 ? (
                <Users size={28} />
              ) : dmOther ? (
                <PersonAvatar
                  userId={dmOther.userId}
                  avatarUrl={profiles[dmOther.userId]?.avatarUrl ?? dmOther.avatarUrl}
                  size={AVATAR}
                  className="border-0"
                />
              ) : (
                <User size={28} />
              )
            ) : (
              <MessageSquare size={28} />
            )}
            {dmOnline && (
              <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface-overlay bg-green-500" />
            )}
          </div>

          <h2 className="mt-3 max-w-full truncate text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {kindLabel}
            {entry.kind === "dm" && dmOther
              ? dmOnline
                ? " · online"
                : ""
              : ` · ${members.length} os.`}
          </p>

          {entry.description?.trim() && (
            <p className="mt-2 max-w-full text-[13px] leading-snug text-ink-light">
              {entry.description.trim()}
            </p>
          )}
        </div>

        <div className="mt-4 border-t border-line/70 pt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            {entry.kind === "dm" && members.length <= 2 ? "Uczestnicy" : "Członkowie"} ·{" "}
            {members.length}
          </div>
          <ul className="thin-scrollbar max-h-[min(40vh,280px)] space-y-0.5 overflow-y-auto">
            {members.map((m) => {
              const online = isOnline(profiles[m.userId]?.lastSeenAt);
              const roleLabel =
                m.role === "owner" ? "właściciel" : m.role === "admin" ? "admin" : null;
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5"
                >
                  <span className="relative shrink-0">
                    <PersonAvatar
                      userId={m.userId}
                      avatarUrl={profiles[m.userId]?.avatarUrl ?? m.avatarUrl}
                      size={32}
                    />
                    {online && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-surface-overlay bg-green-500" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {m.displayName || "Bez nazwy"}
                      {m.userId === myUserId ? " (Ty)" : ""}
                    </span>
                    {roleLabel && (
                      <span className="text-[11px] text-ink-faint">{roleLabel}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {canManage && onManage && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onManage();
            }}
            className="mt-4 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-[13px] font-medium text-ink transition hover:border-line-strong"
          >
            Zarządzaj kanałem
          </button>
        )}
      </div>
    </Modal>
  );
}
