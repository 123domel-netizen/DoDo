import { cloudEnabled, supabase } from "@/lib/supabase";
import { mapOrgRpcError, type OrgPlanCode } from "@/lib/orgsPlans";

export type OrgMemberRole = "admin" | "member";

export interface MyOrg {
  id: string;
  name: string;
  planCode: OrgPlanCode;
  seatLimit: number;
  planEndsAt: string | null;
  invitesLocked: boolean;
  createdAt: string;
  seatUsed: number;
  myRole: OrgMemberRole;
}

export interface OrgListRow {
  id: string;
  name: string;
  planCode: OrgPlanCode;
  seatLimit: number;
  planEndsAt: string | null;
  adminNote: string | null;
  invitesLocked: boolean;
  createdAt: string;
  seatUsed: number;
  adminUserId: string | null;
  adminEmail: string | null;
  adminDisplayName: string | null;
}

export interface OrgMemberRow {
  userId: string;
  role: OrgMemberRole;
  joinedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OrgInvitationRow {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

export interface OrgDetail {
  id: string;
  name: string;
  planCode: OrgPlanCode;
  seatLimit: number;
  planEndsAt: string | null;
  adminNote: string | null;
  invitesLocked: boolean;
  createdAt: string;
  seatUsed: number;
  canInvite: boolean;
  overLimit: boolean;
  myRole: OrgMemberRole | null;
  members: OrgMemberRow[];
  invitations: OrgInvitationRow[];
}

function asPlan(code: unknown): OrgPlanCode {
  const c = String(code ?? "demo").toLowerCase();
  if (c === "basic" || c === "pro" || c === "team" || c === "custom") return c;
  return "demo";
}

function mapMyOrg(row: Record<string, unknown>): MyOrg {
  return {
    id: row.id as string,
    name: row.name as string,
    planCode: asPlan(row.plan_code),
    seatLimit: Number(row.seat_limit),
    planEndsAt: (row.plan_ends_at as string | null) ?? null,
    invitesLocked: Boolean(row.invites_locked),
    createdAt: row.created_at as string,
    seatUsed: Number(row.seat_used),
    myRole: row.my_role === "admin" ? "admin" : "member",
  };
}

function mapListRow(row: Record<string, unknown>): OrgListRow {
  return {
    id: row.id as string,
    name: row.name as string,
    planCode: asPlan(row.plan_code),
    seatLimit: Number(row.seat_limit),
    planEndsAt: (row.plan_ends_at as string | null) ?? null,
    adminNote: (row.admin_note as string | null) ?? null,
    invitesLocked: Boolean(row.invites_locked),
    createdAt: row.created_at as string,
    seatUsed: Number(row.seat_used),
    adminUserId: (row.admin_user_id as string | null) ?? null,
    adminEmail: (row.admin_email as string | null) ?? null,
    adminDisplayName: (row.admin_display_name as string | null) ?? null,
  };
}

function mapDetail(raw: Record<string, unknown>): OrgDetail {
  const members = (raw.members as Record<string, unknown>[] | null) ?? [];
  const invitations = (raw.invitations as Record<string, unknown>[] | null) ?? [];
  return {
    id: raw.id as string,
    name: raw.name as string,
    planCode: asPlan(raw.planCode),
    seatLimit: Number(raw.seatLimit),
    planEndsAt: (raw.planEndsAt as string | null) ?? null,
    adminNote: (raw.adminNote as string | null) ?? null,
    invitesLocked: Boolean(raw.invitesLocked),
    createdAt: raw.createdAt as string,
    seatUsed: Number(raw.seatUsed),
    canInvite: Boolean(raw.canInvite),
    overLimit: Boolean(raw.overLimit),
    myRole: raw.myRole === "admin" ? "admin" : raw.myRole === "member" ? "member" : null,
    members: members.map((m) => ({
      userId: m.userId as string,
      role: m.role === "admin" ? "admin" : "member",
      joinedAt: m.joinedAt as string,
      email: (m.email as string | null) ?? null,
      displayName: (m.displayName as string | null) ?? null,
      avatarUrl: (m.avatarUrl as string | null) ?? null,
    })),
    invitations: invitations.map((i) => ({
      id: i.id as string,
      email: i.email as string,
      status: i.status as string,
      expiresAt: i.expiresAt as string,
      createdAt: i.createdAt as string,
      invitedBy: (i.invitedBy as string | null) ?? null,
    })),
  };
}

export async function checkIsAppAdmin(): Promise<boolean> {
  if (!cloudEnabled || !supabase) return false;
  const { data, error } = await supabase.rpc("is_app_admin");
  if (error) {
    console.warn("[orgs] is_app_admin:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function fetchMyOrgs(): Promise<MyOrg[]> {
  if (!cloudEnabled || !supabase) return [];
  const { data, error } = await supabase.rpc("org_my_orgs");
  if (error) {
    console.warn("[orgs] org_my_orgs:", error.message);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map(mapMyOrg);
}

export async function acceptPendingOrgInvites(): Promise<number> {
  if (!cloudEnabled || !supabase) return 0;
  const { data, error } = await supabase.rpc("org_accept_pending_invites");
  if (error) {
    console.warn("[orgs] accept invites:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

export async function fetchOrgDetail(orgId: string): Promise<OrgDetail | null> {
  if (!cloudEnabled || !supabase) return null;
  const { data, error } = await supabase.rpc("org_get_detail", { p_org_id: orgId });
  if (error) {
    console.warn("[orgs] detail:", error.message);
    return null;
  }
  if (!data || typeof data !== "object") return null;
  return mapDetail(data as Record<string, unknown>);
}

export async function inviteToOrg(
  orgId: string,
  email: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Wymagane logowanie w chmurze." };
  const { error } = await supabase.rpc("org_invite", {
    p_org_id: orgId,
    p_email: email.trim().toLowerCase(),
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function cancelOrgInvite(invitationId: string): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("org_cancel_invite", {
    p_invitation_id: invitationId,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function removeOrgMember(
  orgId: string,
  userId: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("org_remove_member", {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function renameOrg(orgId: string, name: string): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("org_rename", {
    p_org_id: orgId,
    p_name: name,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appListOrgs(): Promise<OrgListRow[]> {
  if (!cloudEnabled || !supabase) return [];
  const { data, error } = await supabase.rpc("app_list_orgs");
  if (error) {
    console.warn("[orgs] app_list_orgs:", error.message);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map(mapListRow);
}

export async function appFindUserByEmail(
  email: string,
): Promise<{ userId: string; email: string; displayName: string | null } | null> {
  if (!cloudEnabled || !supabase) return null;
  const { data, error } = await supabase.rpc("app_find_user_by_email", {
    p_email: email.trim().toLowerCase(),
  });
  if (error) {
    console.warn("[orgs] find user:", error.message);
    return null;
  }
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    userId: row.user_id as string,
    email: row.email as string,
    displayName: (row.display_name as string | null) ?? null,
  };
}

export async function appCreateOrg(opts: {
  name: string;
  adminUserId: string;
  planCode: OrgPlanCode;
  customLimit?: number | null;
  adminNote?: string | null;
}): Promise<{ orgId?: string; error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase.rpc("app_create_org", {
    p_name: opts.name,
    p_admin_user_id: opts.adminUserId,
    p_plan_code: opts.planCode,
    p_custom_limit: opts.planCode === "custom" ? opts.customLimit ?? null : null,
    p_admin_note: opts.adminNote ?? null,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return { orgId: data as string };
}

export async function appSetOrgPlan(
  orgId: string,
  planCode: OrgPlanCode,
  customLimit?: number | null,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_set_org_plan", {
    p_org_id: orgId,
    p_plan_code: planCode,
    p_custom_limit: planCode === "custom" ? customLimit ?? null : null,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appSetOrgSeatLimit(
  orgId: string,
  seatLimit: number,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_set_org_seat_limit", {
    p_org_id: orgId,
    p_seat_limit: seatLimit,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appSetOrgAdmin(
  orgId: string,
  newAdminUserId: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_set_org_admin", {
    p_org_id: orgId,
    p_new_admin_user_id: newAdminUserId,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appSetOrgNote(
  orgId: string,
  note: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_set_org_note", {
    p_org_id: orgId,
    p_note: note,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appSetInvitesLocked(
  orgId: string,
  locked: boolean,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_set_invites_locked", {
    p_org_id: orgId,
    p_locked: locked,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appCancelOrgInvite(
  invitationId: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_cancel_org_invite", {
    p_invitation_id: invitationId,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function appRemoveOrgMember(
  orgId: string,
  userId: string,
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("app_remove_org_member", {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (error) return { error: mapOrgRpcError(error.message) };
  return {};
}

export async function bootstrapOrgs(): Promise<{
  isAppAdmin: boolean;
  myOrgs: MyOrg[];
  acceptedInvites: number;
}> {
  const acceptedInvites = await acceptPendingOrgInvites();
  const [isAppAdmin, myOrgs] = await Promise.all([checkIsAppAdmin(), fetchMyOrgs()]);
  return { isAppAdmin, myOrgs, acceptedInvites };
}
