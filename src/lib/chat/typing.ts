import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * CHAT6: wskaźnik „X pisze…" — Supabase Realtime broadcast per rozmowa.
 * Zero tabel i zero zapisu w DB; sygnał żyje tylko, gdy obie strony mają
 * otwartą rozmowę. Nadawanie throttlowane, odbiór wygasa po TYPING_EXPIRE_MS.
 */

export const TYPING_THROTTLE_MS = 2000;
export const TYPING_EXPIRE_MS = 5000;

export interface TypingPayload {
  userId: string;
  name: string;
}

export interface TypingHandle {
  /** Wyślij sygnał pisania (throttle wewnątrz). */
  notify: (payload: TypingPayload) => void;
  unsubscribe: () => void;
}

export function joinTyping(
  conversationId: string,
  onTyping: (payload: TypingPayload) => void,
): TypingHandle | null {
  if (!supabase) return null;
  let lastSentAt = 0;
  const channel: RealtimeChannel = supabase
    .channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as Partial<TypingPayload> | undefined;
      if (p?.userId && p.name) onTyping({ userId: p.userId, name: p.name });
    })
    .subscribe();

  return {
    notify: (payload) => {
      const now = Date.now();
      if (now - lastSentAt < TYPING_THROTTLE_MS) return;
      lastSentAt = now;
      void channel.send({ type: "broadcast", event: "typing", payload });
    },
    unsubscribe: () => {
      if (supabase) void supabase.removeChannel(channel);
    },
  };
}

/** Etykieta wskaźnika: „Ala pisze…" / „Ala i Ola piszą…". */
export function typingLabel(names: string[]): string | null {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return null;
  if (unique.length === 1) return `${unique[0]} pisze…`;
  if (unique.length === 2) return `${unique[0]} i ${unique[1]} piszą…`;
  return "Kilka osób pisze…";
}
