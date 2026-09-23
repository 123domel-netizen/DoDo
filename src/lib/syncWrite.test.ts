import { describe, expect, it } from "vitest";
import { notifyLocalItemWrite } from "./syncWrite";

describe("syncWrite — v2 notify removed", () => {
  it("notifyLocalItemWrite is a no-op", () => {
    expect(() => notifyLocalItemWrite("abc")).not.toThrow();
    expect(() => notifyLocalItemWrite("")).not.toThrow();
  });

  it("does not export registerLocalItemWriteHandler", async () => {
    const mod = await import("./syncWrite");
    expect("registerLocalItemWriteHandler" in mod).toBe(false);
    expect("setSyncV3BlocksNotify" in mod).toBe(false);
  });
});
