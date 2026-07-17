import { describe, expect, it } from "vitest";
import { aggregatePoll, groupReactions } from "@/lib/chat/polls";
import type { ChatMessage } from "@/lib/chat/types";

function pollMsg(votes: { userId: string; optionId: string }[]): ChatMessage {
  return {
    id: "p1",
    conversationId: "c1",
    authorUserId: "u1",
    kind: "poll",
    body: "Który termin?",
    payload: {
      poll: {
        options: [
          { id: "o1", label: "Poniedziałek" },
          { id: "o2", label: "Wtorek" },
        ],
      },
    },
    mentions: [],
    threadRootId: null,
    replyToMessageId: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    votes: votes.map((v) => ({ messageId: "p1", ...v })),
  };
}

describe("aggregatePoll", () => {
  it("liczy głosy, procenty i moją opcję", () => {
    const msg = pollMsg([
      { userId: "a", optionId: "o1" },
      { userId: "b", optionId: "o1" },
      { userId: "me", optionId: "o2" },
    ]);
    const res = aggregatePoll(msg, "me");
    expect(res.totalVotes).toBe(3);
    expect(res.myOptionId).toBe("o2");
    expect(res.options[0].count).toBe(2);
    expect(res.options[0].percent).toBe(67);
    expect(res.options[1].mine).toBe(true);
  });

  it("brak głosów → 0% i myOptionId null", () => {
    const res = aggregatePoll(pollMsg([]), "me");
    expect(res.totalVotes).toBe(0);
    expect(res.myOptionId).toBeNull();
    expect(res.options.every((o) => o.percent === 0)).toBe(true);
  });
});

describe("groupReactions", () => {
  it("grupuje po emoji, zlicza i wykrywa moją", () => {
    const groups = groupReactions(
      [
        { emoji: "👍", userId: "a" },
        { emoji: "👍", userId: "me" },
        { emoji: "🎉", userId: "b" },
      ],
      "me",
    );
    expect(groups).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🎉", count: 1, mine: false },
    ]);
  });

  it("pusta lista → []", () => {
    expect(groupReactions(undefined, "me")).toEqual([]);
  });
});
