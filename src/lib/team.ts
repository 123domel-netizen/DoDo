import type { TeamMember } from "@/types";
import { cloudEnabled, supabase } from "@/lib/supabase";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToTeamMember(row: Record<string, unknown>): TeamMember {
  return {
    id: row.id as string,
    ownerUserId: row.owner_user_id as string,
    memberUserId: (row.member_user_id as string | null) ?? null,
    email: row.email as string,
    displayName: (row.display_name as string | null) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  if (!cloudEnabled || !supabase) return [];
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[team] fetch failed:", error.message);
    return [];
  }
  return (data ?? []).map(rowToTeamMember);
}

export async function addTeamMember(
  email: string,
  displayName?: string | null,
): Promise<{ member?: TeamMember; error?: string }> {
  if (!cloudEnabled || !supabase) {
    return { error: "Wymagane logowanie w chmurze." };
  }
  const norm = normalizeEmail(email);
  if (!norm.includes("@")) return { error: "Podaj poprawny adres e-mail." };

  const { data, error } = await supabase.rpc("add_team_member", {
    p_email: norm,
    p_display_name: displayName?.trim() || null,
  });
  if (error) return { error: error.message };
  return { member: rowToTeamMember(data as Record<string, unknown>) };
}

export async function updateTeamMemberDisplayName(
  id: string,
  displayName: string | null,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("team_members")
    .update({
      display_name: displayName?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

export async function deleteTeamMember(id: string): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("team_members").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

export function teamMemberLabel(m: TeamMember): string {
  return m.displayName?.trim() || m.email;
}

export async function rejectItemParticipation(itemId: string): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("update_own_participation_status", {
    p_item_id: itemId,
    p_status: "rejected",
  });
  return error ? { error: error.message } : {};
}

export async function updateOwnParticipationStatus(
  itemId: string,
  status: "invited" | "accepted" | "rejected" | "active",
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("update_own_participation_status", {
    p_item_id: itemId,
    p_status: status,
  });
  return error ? { error: error.message } : {};
}
