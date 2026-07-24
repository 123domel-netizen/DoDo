import { PersonAvatar } from "@/components/chat/PersonAvatar";
import type { ChatEligiblePerson } from "@/lib/contacts";

/** Sekcja „Kontakty” — osoby z zespołu bez rozpoczętego DM (kompaktowy rząd). */
export function ContactDiscoverSection({
  contacts,
  onStart,
  busyUserId,
}: {
  contacts: ChatEligiblePerson[];
  onStart: (userId: string) => void;
  busyUserId?: string | null;
}) {
  if (contacts.length === 0) return null;

  return (
    <section className="border-t border-line/50">
      <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        Kontakty
        <span className="ml-1 font-normal opacity-70">{contacts.length}</span>
      </div>
      <div className="thin-scrollbar flex gap-2 overflow-x-auto px-3 pb-1.5">
        {contacts.map((c) => (
          <button
            key={c.userId}
            type="button"
            disabled={busyUserId === c.userId}
            onClick={() => onStart(c.userId)}
            title={`Napisz do ${c.displayName}`}
            className="flex w-11 shrink-0 flex-col items-center gap-0.5 disabled:opacity-50"
          >
            <span className="rounded-full border border-dashed border-line/80 p-px">
              <PersonAvatar
                userId={c.userId}
                avatarUrl={c.avatarUrl}
                size={28}
                className="border-0"
              />
            </span>
            <span className="w-full truncate text-center text-[9px] leading-tight text-ink-faint">
              {c.displayName}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
