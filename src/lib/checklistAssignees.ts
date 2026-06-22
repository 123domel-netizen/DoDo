import type { Item, Participant } from "@/types";
import { isSharedItem } from "@/lib/share";

export interface ChecklistAssignee {
  userId: string;
  label: string;
  initials: string;
}

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  const t = label.trim();
  return (t.length >= 2 ? t.slice(0, 2) : t.slice(0, 1) || "?").toUpperCase();
}

function labelFromAuth(authUserEmail: string | null): string {
  if (authUserEmail) {
    const local = authUserEmail.split("@")[0] ?? authUserEmail;
    return local.replace(/[._]/g, " ").trim() || authUserEmail;
  }
  return "Ja";
}

function participantLabel(p: Participant): string {
  return p.name?.trim() || p.email?.trim() || "Uczestnik";
}

function addAssignee(
  map: Map<string, ChecklistAssignee>,
  userId: string | null | undefined,
  label: string,
) {
  const id = userId?.trim();
  if (!id || map.has(id)) return;
  const name = label.trim() || "Użytkownik";
  map.set(id, { userId: id, label: name, initials: initialsFromLabel(name) });
}

/** Osoby dostępne do przypisania punktu checklisty (właściciel + uczestnicy). */
export function checklistAssigneesForItem(
  item: Item,
  authUserId: string | null,
  authUserEmail: string | null,
): ChecklistAssignee[] {
  const map = new Map<string, ChecklistAssignee>();
  const shared = isSharedItem(item);
  const ownerId = item.ownerUserId ?? (shared ? null : authUserId);

  if (ownerId) {
    const ownerLabel =
      authUserId && ownerId === authUserId
        ? labelFromAuth(authUserEmail)
        : "Właściciel";
    addAssignee(map, ownerId, ownerLabel);
  } else if (!shared && authUserId) {
    addAssignee(map, authUserId, labelFromAuth(authUserEmail));
  }

  for (const p of item.participants) {
    if (p.status === "rejected") continue;
    addAssignee(map, p.userId, participantLabel(p));
  }

  if (authUserId) {
    addAssignee(map, authUserId, labelFromAuth(authUserEmail));
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

export function checklistAssigneeLabel(
  assignees: ChecklistAssignee[],
  assignedUserId?: string | null,
): string {
  if (!assignedUserId) return "Nieprzypisane";
  return assignees.find((a) => a.userId === assignedUserId)?.label ?? "Przypisane";
}

export function checklistAssigneeInitials(
  assignees: ChecklistAssignee[],
  assignedUserId?: string | null,
): string {
  if (!assignedUserId) return "—";
  return assignees.find((a) => a.userId === assignedUserId)?.initials ?? "?";
}
