import { describe, expect, it } from "vitest";
import { participantsFromConversationMembers } from "@/lib/chat/conversationParticipants";
import type { TeamMember } from "@/types";

function team(partial: Partial<TeamMember> & Pick<TeamMember, "id" | "email">): TeamMember {
  return {
    ownerUserId: "owner",
    memberUserId: partial.memberUserId ?? null,
    displayName: partial.displayName ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("participantsFromConversationMembers", () => {
  it("mapuje członków z kontaktu zespołu, pomija nadawcę i osoby bez kontaktu", () => {
    const members = [
      { userId: "me", displayName: "Ja" },
      { userId: "u2", displayName: "Ola" },
      { userId: "u3", displayName: "Bez kontaktu" },
    ];
    const teamMembers = [
      team({ id: "t1", email: "ola@ex.pl", memberUserId: "u2", displayName: "Ola" }),
      team({ id: "t2", email: "me@ex.pl", memberUserId: "me", displayName: "Ja" }),
    ];
    const got = participantsFromConversationMembers(members, teamMembers, "me");
    expect(got).toHaveLength(1);
    expect(got[0].email).toBe("ola@ex.pl");
    expect(got[0].userId).toBe("u2");
    expect(got[0].status).toBe("invited");
  });

  it("deduplikuje po e-mailu", () => {
    const members = [
      { userId: "a", displayName: "A" },
      { userId: "b", displayName: "B" },
    ];
    const teamMembers = [
      team({ id: "t1", email: "same@ex.pl", memberUserId: "a" }),
      team({ id: "t2", email: "same@ex.pl", memberUserId: "b" }),
    ];
    expect(participantsFromConversationMembers(members, teamMembers, null)).toHaveLength(1);
  });
});
