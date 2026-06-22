import type { Participant, ParticipantStatus, Reminder } from "@/types";
import type { TeamMember } from "@/types";
import { teamMemberLabel } from "@/lib/team";
import { uid } from "@/lib/factory";

export { PARTICIPANT_STATUS_LABELS } from "@/types";

type ParticipantDbRow = {
  id: string;
  item_id: string;
  participant_email: string;
  participant_display_name: string | null;
  participant_user_id: string | null;
  status: string;
  personal_reminders?: unknown;
};

export type { ParticipantDbRow };

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

export function participantFromDbRow(row: ParticipantDbRow): Participant {
  const email = row.participant_email.toLowerCase();
  return {
    id: row.id,
    email,
    name: row.participant_display_name?.trim() || email,
    userId: row.participant_user_id,
    status: row.status as ParticipantStatus,
  };
}

export function personalRemindersFromDbRow(row: ParticipantDbRow): Reminder[] {
  return (row.personal_reminders as Reminder[] | undefined) ?? [];
}

export function mergeParticipantsWithDb(
  payloadParticipants: Participant[],
  dbRows: ParticipantDbRow[],
): Participant[] {
  const byEmail = new Map<string, Participant>();
  for (const row of dbRows) {
    const p = participantFromDbRow(row);
    if (p.email) byEmail.set(p.email, p);
  }

  const merged: Participant[] = [];
  const seen = new Set<string>();

  for (const p of payloadParticipants) {
    const email = p.email?.toLowerCase();
    const db = email ? byEmail.get(email) : undefined;
    merged.push(
      db
        ? {
            ...p,
            id: db.id,
            status: db.status,
            name: p.name || db.name,
            userId: p.userId ?? db.userId,
          }
        : p,
    );
    if (email) seen.add(email);
  }

  for (const [email, db] of byEmail) {
    if (!seen.has(email)) merged.push(db);
  }

  return merged;
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
