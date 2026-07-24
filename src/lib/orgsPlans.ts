/** Katalog planów DoDo (musi być zgodny z RPC `org_plan_default_limit`). */

export type OrgPlanCode = "demo" | "basic" | "pro" | "team" | "custom";

export const ORG_PLAN_OPTIONS: {
  code: OrgPlanCode;
  label: string;
  defaultLimit: number | null;
}[] = [
  { code: "demo", label: "Demo", defaultLimit: 2 },
  { code: "basic", label: "Basic", defaultLimit: 10 },
  { code: "pro", label: "Pro", defaultLimit: 20 },
  { code: "team", label: "Team", defaultLimit: 50 },
  { code: "custom", label: "Custom", defaultLimit: null },
];

export function orgPlanDefaultLimit(plan: string): number | null {
  const found = ORG_PLAN_OPTIONS.find((p) => p.code === plan.toLowerCase());
  return found ? found.defaultLimit : null;
}

export function orgPlanLabel(plan: string): string {
  const found = ORG_PLAN_OPTIONS.find((p) => p.code === plan.toLowerCase());
  return found?.label ?? plan;
}

export function formatSeatUsage(used: number, limit: number): string {
  return `${used} z ${limit} miejsc`;
}

export function isOverSeatLimit(used: number, limit: number): boolean {
  return used > limit;
}

export function canInviteSeats(opts: {
  used: number;
  limit: number;
  invitesLocked: boolean;
}): boolean {
  if (opts.invitesLocked) return false;
  return opts.used < opts.limit;
}

/** Mapuje komunikaty RPC na czytelny PL. */
export function mapOrgRpcError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("seat limit")) {
    return "Brak wolnych miejsc w planie. Zwiększ plan lub usuń zaproszenie / członka.";
  }
  if (m.includes("invites locked")) {
    return "Zaproszenia są zablokowane przez administratora aplikacji.";
  }
  if (m.includes("already a member")) return "Ta osoba jest już w zespole.";
  if (m.includes("invite already pending")) return "Zaproszenie dla tego adresu już czeka.";
  if (m.includes("cannot remove org admin")) {
    return "Nie można usunąć administratora zespołu. Najpierw przekaż rolę.";
  }
  if (m.includes("forbidden")) return "Brak uprawnień.";
  if (m.includes("must belong to an org")) {
    return "Dołącz do zespołu, aby tworzyć rozmowy.";
  }
  if (m.includes("members must share an org") || m.includes("target not in your org")) {
    return "Możesz rozmawiać tylko z osobami ze swojego zespołu.";
  }
  if (m.includes("must share an org with a channel member")) {
    return "Ten kanał należy do innego zespołu.";
  }
  if (m.includes("invalid email")) return "Podaj poprawny adres e-mail.";
  if (m.includes("invalid name")) return "Podaj nazwę zespołu.";
  if (m.includes("invalid display name")) {
    return "Podaj imię lub nazwę (1–80 znaków).";
  }
  if (m.includes("member not found")) return "Nie znaleziono członka zespołu.";
  if (m.includes("org admin missing")) {
    return "Zespół nie ma administratora — skontaktuj się z supportem.";
  }
  if (m.includes("invalid plan")) return "Nieprawidłowy plan.";
  if (m.includes("custom limit")) return "Dla planu Custom podaj limit miejsc (≥ 1).";
  if (m.includes("admin user not found") || m.includes("user not found")) {
    return "Nie znaleziono użytkownika. Musi się wcześniej zalogować przez Google.";
  }
  return message?.trim() || "Operacja nie powiodła się.";
}
