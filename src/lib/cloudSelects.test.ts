import { describe, expect, it } from "vitest";
import {
  GROUPS_SELECT,
  ITEMS_SELECT,
  OWNER_PARTICIPANTS_SELECT,
  SHARED_ITEMS_EMBED_SELECT,
  TAG_ASSIGNMENTS_SELECT,
  USER_TAGS_SELECT,
  assertUserScopedFilter,
} from "@/lib/cloudSelects";

describe("cloudSelects", () => {
  it("uses explicit column lists instead of select(*)", () => {
    for (const select of [
      ITEMS_SELECT,
      GROUPS_SELECT,
      USER_TAGS_SELECT,
      OWNER_PARTICIPANTS_SELECT,
      TAG_ASSIGNMENTS_SELECT,
      SHARED_ITEMS_EMBED_SELECT,
    ]) {
      expect(select.includes("*")).toBe(false);
      expect(select.length).toBeGreaterThan(0);
    }
  });

  it("items select includes ownership and soft-delete columns", () => {
    expect(ITEMS_SELECT).toContain("user_id");
    expect(ITEMS_SELECT).toContain("deleted_at");
    expect(ITEMS_SELECT).toContain("payload");
    expect(ITEMS_SELECT).toContain("updated_at");
  });

  it("shared embed still scopes item columns explicitly (never items(*))", () => {
    expect(SHARED_ITEMS_EMBED_SELECT.startsWith("status,personal_reminders,items(")).toBe(
      true,
    );
    expect(SHARED_ITEMS_EMBED_SELECT).toContain("user_id");
    expect(SHARED_ITEMS_EMBED_SELECT.includes("items(*)")).toBe(false);
    expect(SHARED_ITEMS_EMBED_SELECT).toContain(ITEMS_SELECT);
  });

  it("requires user_id scope filter (workspace equivalent)", () => {
    expect(assertUserScopedFilter("u-1")).toBe("u-1");
    expect(() => assertUserScopedFilter(null)).toThrow(/user_id/);
    expect(() => assertUserScopedFilter(undefined)).toThrow(/user_id/);
    expect(() => assertUserScopedFilter("")).toThrow(/user_id/);
  });
});
