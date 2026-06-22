import type { Participant } from "@/types";
import type { TeamMember } from "@/types";
import { teamMemberLabel } from "@/lib/team";
import { uid } from "@/lib/factory";

export function participantFromTeamMember(member: TeamMember): Participant {
  return {
    id: uid(),
    teamMemberId: member.id,
    userId: member.memberUserId,
    email: member.email,
    name: teamMemberLabel(member),
    status: "invited",
  };
}

export function participantRowFromParticipant(
  itemId: string,
  ownerUserId: string,
  p: Participant,
) {
  const email = (p.email ?? "").trim().toLowerCase();
  if (!email) return null;
  return {
    item_id: itemId,
    owner_user_id: ownerUserId,
    participant_user_id: p.userId ?? null,
    participant_email: email,
    participant_display_name: p.name || null,
    status: p.status ?? "invited",
  };
}
