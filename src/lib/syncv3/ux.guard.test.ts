import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sync v3 UX — no manual send", () => {
  it("App does not mount SyncPendingBanner", () => {
    const src = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/SyncPendingBanner/);
    expect(src).not.toMatch(/Wyślij/);
  });

  it("SyncSettings has no Wyślij teraz / flushPendingPush / dirty counts", () => {
    const src = readFileSync(
      new URL("../../components/settings/SyncSettings.tsx", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/Wyślij teraz/);
    expect(src).not.toMatch(/flushPendingPush/);
    expect(src).not.toMatch(/dirtyItemsCount/);
    expect(src).not.toMatch(/lastPushError/);
  });
});
