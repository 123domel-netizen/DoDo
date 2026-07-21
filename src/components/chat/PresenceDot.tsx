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

export { dmPeerPresence };
