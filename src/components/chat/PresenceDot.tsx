import { dmPeerPresence, type DmPresence } from "@/lib/chat/presence";

export function PresenceDot({ presence }: { presence: DmPresence | null }) {
  if (!presence) return null;
  const online = presence === "online";
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        online ? "bg-green-500" : "bg-ink-faint/45"
      }`}
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
    />
  );
}

/** Marker kanału w tym samym slocie co kropka obecności przy DM. */
export function ChannelHashMark() {
  return (
    <span
      className="flex h-1.5 w-1.5 shrink-0 items-center justify-center text-[9px] font-bold leading-none text-ink-faint"
      title="Kanał"
      aria-label="Kanał"
    >
      #
    </span>
  );
}

/** DM → obecność; kanał → #; inne → nic. */
export function ConversationKindMark({
  kind,
  presence,
}: {
  kind: string;
  presence: DmPresence | null;
}) {
  if (kind === "channel") return <ChannelHashMark />;
  return <PresenceDot presence={presence} />;
}

export { dmPeerPresence };
