import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertNoHardcodedProdOnlyRedirect,
  buildOAuthRedirectTo,
  isAllowedOAuthOrigin,
  oauthRedirectUrlFromOrigin,
  resolveSafeReturnTo,
} from "./authRedirect";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("OAuth redirect origins", () => {
  it("production login passes production origin", () => {
    expect(oauthRedirectUrlFromOrigin("https://dodo-c39.pages.dev")).toBe(
      "https://dodo-c39.pages.dev/",
    );
    expect(
      buildOAuthRedirectTo({ origin: "https://dodo-c39.pages.dev" }),
    ).toBe("https://dodo-c39.pages.dev/");
  });

  it("preview login passes preview origin", () => {
    expect(
      oauthRedirectUrlFromOrigin("https://media-r2-preview.dodo-c39.pages.dev"),
    ).toBe("https://media-r2-preview.dodo-c39.pages.dev/");
    expect(
      buildOAuthRedirectTo({
        origin: "https://media-r2-preview.dodo-c39.pages.dev",
      }),
    ).toBe("https://media-r2-preview.dodo-c39.pages.dev/");
  });

  it("localhost login passes localhost", () => {
    expect(oauthRedirectUrlFromOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173/",
    );
    expect(oauthRedirectUrlFromOrigin("http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173/",
    );
  });

  it("does not hardcode production redirectTo in auth.ts", () => {
    const src = readFileSync(join(__dirname, "auth.ts"), "utf8");
    expect(assertNoHardcodedProdOnlyRedirect(src)).toBe(true);
    expect(src).not.toMatch(/redirectTo:\s*["']https:\/\/dodo-c39\.pages\.dev/);
    expect(src).toMatch(/buildOAuthRedirectTo|oauthRedirectUrl/);
  });

  it("rejects disallowed external returnTo (open redirect)", () => {
    expect(
      resolveSafeReturnTo("https://evil.example/phish", "https://dodo-c39.pages.dev"),
    ).toBeNull();
    expect(
      resolveSafeReturnTo("//evil.example/phish", "https://dodo-c39.pages.dev"),
    ).toBeNull();
    expect(
      resolveSafeReturnTo(
        "https://media-r2-preview.dodo-c39.pages.dev/chat",
        "https://dodo-c39.pages.dev",
      ),
    ).toBeNull();
    expect(resolveSafeReturnTo("/chat", "https://dodo-c39.pages.dev")).toBe("/chat");
    expect(isAllowedOAuthOrigin("https://evil.example")).toBe(false);
  });
});
