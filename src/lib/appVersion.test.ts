import { describe, expect, it } from "vitest";
import { isClientVersionStale } from "@/lib/appVersion";

describe("isClientVersionStale", () => {
  it("ignores empty or dev server version", () => {
    expect(isClientVersionStale("abc123", null)).toBe(false);
    expect(isClientVersionStale("abc123", "")).toBe(false);
    expect(isClientVersionStale("abc123", "dev")).toBe(false);
  });

  it("detects mismatch", () => {
    expect(isClientVersionStale("abc123", "def456")).toBe(true);
  });

  it("matches same version", () => {
    expect(isClientVersionStale("abc123", "abc123")).toBe(false);
  });
});
