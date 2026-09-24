import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Sync v3 cleanup — debug stubs", () => {
  it("syncDebug module does not install a global inspect API", () => {
    const src = readFileSync(new URL("./syncDebug.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/__dodo/);
    expect(src).not.toMatch(/dodo-sync-debug/);
    expect(src).not.toMatch(/localStorage/);
  });
});
