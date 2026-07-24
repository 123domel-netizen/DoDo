import type { Participant, TeamMember } from "@/types";
import { participantFromTeamMember } from "@/lib/participants";

/** Mapuj członków rozmowy → zaproszeni uczestnicy itemu (po kontakcie zespołu). */
export function participantsFromConversationMembers(
  members: { userId: string; displayName: string }[],
  teamMembers: TeamMember[],
  excludeUserId: string | null,
): Participant[] {
  const out: Participant[] = [];
  const seenEmails = new Set<string>();

  for (const m of members) {
    if (excludeUserId && m.userId === excludeUserId) continue;
    const team = teamMembers.find((t) => t.memberUserId === m.userId);
    if (!team) continue;
    const email = team.email.trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    out.push(participantFromTeamMember(team));
  }

  return out;
}
