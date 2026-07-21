import { Check, CheckCheck } from "lucide-react";
import {
  outboundReadLabel,
  outboundReadStatus,
  type OutboundReadStatus,
} from "@/lib/chat/readReceipts";
import type { ChatOverviewEntry } from "@/lib/chat/types";

function ticksClass(status: OutboundReadStatus): string {
  if (status === "all") return "text-accent";
  if (status === "some") return "text-accent/70";
  return "text-ink-faint/70";
}

/** Ptaszki odczytu przy ostatniej (mojej) wiadomości w wierszu rozmowy. */
export function ReadReceiptTicks({
  entry,
  myUserId,
  className = "",
}: {
  entry: ChatOverviewEntry;
  myUserId: string | null;
  className?: string;
}) {
  const status = outboundReadStatus(entry, myUserId);
  if (!status) return null;
  const others = entry.members.filter((m) => m.userId !== myUserId).length;
  const label = outboundReadLabel(status, others);
  const Icon = status === "none" ? Check : CheckCheck;

  return (
    <span
      className={`inline-flex shrink-0 items-center ${ticksClass(status)} ${className}`}
      title={label}
      aria-label={label}
    >
      <Icon size={12} strokeWidth={status === "all" ? 2.5 : 2} />
    </span>
  );
}
