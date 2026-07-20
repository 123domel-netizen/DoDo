import type { TeamMember } from "@/types";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { fetchTeamMembers } from "@/lib/team";

export interface OrgContact {
  userId: string;
  role: "admin" | "member";
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  muted: boolean;
}

/** Mapuje kontakt z orga do kształtu TeamMember (picker uczestników). */
export function orgContactToTeamMember(c: OrgContact, ownerUserId: string): TeamMember {
  const email = (c.email ?? "").toLowerCase() || `${c.userId}@unknown`;
  return {
    id: c.userId,
    ownerUserId,
    memberUserId: c.userId,
    email,
    displayName: c.displayName,
    createdAt: c.joinedAt,
    updatedAt: c.joinedAt,
    muted: c.muted,
  };
}

export async function fetchOrgContacts(orgId: string): Promise<OrgContact[]> {
  if (!cloudEnabled || !supabase) return [];
  const { data, error } = await supabase.rpc("org_list_contacts", { p_org_id: orgId });
  if (error) {
    console.warn("[contacts] list:", error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    userId: row.userId as string,
    role: row.role === "admin" ? "admin" : "member",
    email: (row.email as string | null) ?? null,
    displayName: (row.displayName as string | null) ?? null,
    avatarUrl: (row.avatarUrl as string | null) ?? null,
    joinedAt: (row.joinedAt as string) ?? new Date().toISOString(),
    muted: Boolean(row.muted),
  }));
}

export async function setOrgContactMute(
  orgId: string,
  mutedUserId: string,
  muted: boolean,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("org_set_contact_mute", {
    p_org_id: orgId,
    p_muted_user_id: mutedUserId,
    p_muted: muted,
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("forbidden")) return { error: "Brak uprawnień." };
    return { error: error.message };
  }
  return {};
}

export async function loadAssignableContacts(opts: {
  orgId: string | null;
  ownerUserId: string | null;
}): Promise<TeamMember[]> {
  if (!cloudEnabled) return [];
  if (opts.orgId) {
    const contacts = await fetchOrgContacts(opts.orgId);
    return contacts.map((c) => orgContactToTeamMember(c, opts.ownerUserId ?? ""));
  }
  return fetchTeamMembers();
}

/** Osoby do DM/kanału: unia kontaktów ze wszystkich orgów użytkownika (bez wyciszonych). */
export async function loadChatEligiblePeople(opts: {
  myOrgs: { id: string }[];
  myUserId: string | null;
}): Promise<
  { userId: string; displayName: string; avatarUrl: string | null }[]
> {
  if (!cloudEnabled || !opts.myUserId || opts.myOrgs.length === 0) return [];
  const byId = new Map<
    string,
    { userId: string; displayName: string; avatarUrl: string | null }
  >();
  for (const org of opts.myOrgs) {
    const contacts = await fetchOrgContacts(org.id);
    for (const c of contacts) {
      if (c.userId === opts.myUserId || c.muted) continue;
      if (byId.has(c.userId)) continue;
      byId.set(c.userId, {
        userId: c.userId,
        displayName: (c.displayName || c.email || c.userId).trim(),
        avatarUrl: c.avatarUrl,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "pl"),
  );
}
