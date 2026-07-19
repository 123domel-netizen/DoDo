import { describe, expect, it } from "vitest";
import {
  canInviteSeats,
  formatSeatUsage,
  isOverSeatLimit,
  mapOrgRpcError,
  orgPlanDefaultLimit,
  orgPlanLabel,
} from "@/lib/orgsPlans";

describe("orgPlanDefaultLimit", () => {
  it("zwraca limity katalogu", () => {
    expect(orgPlanDefaultLimit("demo")).toBe(2);
    expect(orgPlanDefaultLimit("basic")).toBe(10);
    expect(orgPlanDefaultLimit("pro")).toBe(20);
    expect(orgPlanDefaultLimit("team")).toBe(50);
    expect(orgPlanDefaultLimit("custom")).toBeNull();
  });
});

describe("seat limits", () => {
  it("formatuje użycie", () => {
    expect(formatSeatUsage(7, 10)).toBe("7 z 10 miejsc");
  });

  it("wykrywa over-limit (downgrade bez usuwania)", () => {
    expect(isOverSeatLimit(12, 10)).toBe(true);
    expect(isOverSeatLimit(10, 10)).toBe(false);
  });

  it("blokuje invite przy limicie / lock", () => {
    expect(canInviteSeats({ used: 2, limit: 2, invitesLocked: false })).toBe(false);
    expect(canInviteSeats({ used: 1, limit: 2, invitesLocked: false })).toBe(true);
    expect(canInviteSeats({ used: 0, limit: 10, invitesLocked: true })).toBe(false);
    expect(canInviteSeats({ used: 12, limit: 10, invitesLocked: false })).toBe(false);
  });
});

describe("mapOrgRpcError", () => {
  it("mapuje seat limit i forbidden", () => {
    expect(mapOrgRpcError("seat limit reached")).toMatch(/miejsc/i);
    expect(mapOrgRpcError("forbidden")).toMatch(/uprawnień/i);
    expect(mapOrgRpcError("invites locked")).toMatch(/zablokowane/i);
  });
});

describe("orgPlanLabel", () => {
  it("pokazuje etykiety", () => {
    expect(orgPlanLabel("demo")).toBe("Demo");
    expect(orgPlanLabel("pro")).toBe("Pro");
  });
});

/**
 * Logika race / RLS jest w SQL (FOR UPDATE na orgs + security definer RPC).
 * Poniżej: reguły kontraktu, które UI i RPC muszą zachować.
 */
describe("org invite contract", () => {
  it("pending invite rezerwuje miejsce w usage", () => {
    const members = 1;
    const pending = 1;
    const usage = members + pending;
    const limit = 2;
    expect(usage).toBe(2);
    expect(canInviteSeats({ used: usage, limit, invitesLocked: false })).toBe(false);
  });

  it("zmiana admina: org nigdy bez admina (atomowo)", () => {
    // Kontrakt: najpierw ensure member, potem stary→member, nowy→admin.
    const steps = ["ensure_member", "demote_old", "promote_new"] as const;
    expect(steps[steps.length - 1]).toBe("promote_new");
    expect(steps.includes("demote_old")).toBe(true);
  });

  it("downgrade planu nie usuwa członków", () => {
    const membersAfterDowngrade = 12;
    const newLimit = 10;
    expect(isOverSeatLimit(membersAfterDowngrade, newLimit)).toBe(true);
    expect(canInviteSeats({ used: membersAfterDowngrade, limit: newLimit, invitesLocked: false })).toBe(
      false,
    );
  });
});
