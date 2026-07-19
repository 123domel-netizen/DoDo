import type { ChatMessage, PollOption, PollVote } from "@/lib/chat/types";

/**
 * CHAT5-POLLS: agregacja głosów ankiety — czyste funkcje.
 * Ankieta = wiadomość kind='poll'; pytanie w body, opcje w payload.poll.options,
 * głosy w tabeli poll_votes (jeden głos na osobę; zmiana = nadpisanie).
 */

export interface PollOptionResult {
  option: PollOption;
  count: number;
  /** Odsetek 0–100 (0 gdy brak głosów). */
  percent: number;
  mine: boolean;
  voterIds: string[];
}

export interface PollResults {
  totalVotes: number;
  myOptionId: string | null;
  options: PollOptionResult[];
}

export function aggregatePoll(msg: ChatMessage, myUserId: string | null): PollResults {
  const options = msg.payload.poll?.options ?? [];
  const votes = msg.votes ?? [];
  const byOption = new Map<string, PollVote[]>();
  for (const v of votes) {
    const list = byOption.get(v.optionId) ?? [];
    list.push(v);
    byOption.set(v.optionId, list);
  }
  const total = votes.length;
  const mine = myUserId ? votes.find((v) => v.userId === myUserId) : undefined;
  return {
    totalVotes: total,
    myOptionId: mine?.optionId ?? null,
    options: options.map((option) => {
      const list = byOption.get(option.id) ?? [];
      return {
        option,
        count: list.length,
        percent: total ? Math.round((list.length / total) * 100) : 0,
        mine: Boolean(mine && mine.optionId === option.id),
        voterIds: list.map((v) => v.userId),
      };
    }),
  };
}

/** Agregacja reakcji: emoji → liczba + czy moja (kolejność wg pierwszego wystąpienia). */
export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
}

export function groupReactions(
  reactions: { emoji: string; userId: string }[] | undefined,
  myUserId: string | null,
): ReactionGroup[] {
  if (!reactions?.length) return [];
  const order: string[] = [];
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    let g = map.get(r.emoji);
    if (!g) {
      g = { emoji: r.emoji, count: 0, mine: false };
      map.set(r.emoji, g);
      order.push(r.emoji);
    }
    g.count++;
    if (myUserId && r.userId === myUserId) g.mine = true;
  }
  return order.map((e) => map.get(e)!);
}

export const QUICK_REACTIONS = ["👍", "👎", "😂", "❤️", "👀", "✅"];
