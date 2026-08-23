import { describe, expect, it } from "vitest";
import {
  evaluateUrl,
  isBlockedHostname,
  parseIpv6,
  safeFetch,
} from "../../../supabase/functions/_shared/urlPolicy";

describe("isBlockedHostname", () => {
  it("allows ordinary public hosts", () => {
    for (const h of ["example.com", "www.wp.pl", "8.8.8.8", "203.0.114.5"]) {
      expect(isBlockedHostname(h), h).toBe(false);
    }
  });

  it("blocks loopback and local suffixes", () => {
    for (const h of [
      "localhost",
      "app.localhost",
      "nas.local",
      "db.internal",
      "printer.home.arpa",
      "intranet-host",
    ]) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });

  it("blocks private, loopback and cloud-metadata IPv4", () => {
    for (const h of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });

  it("keeps public IPv4 next to private ranges reachable", () => {
    for (const h of ["172.15.0.1", "172.32.0.1", "192.167.1.1", "100.63.0.1"]) {
      expect(isBlockedHostname(h), h).toBe(false);
    }
  });

  it("blocks private IPv6 and IPv4-mapped forms", () => {
    for (const h of [
      "[::1]",
      "::1",
      "[::]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[fe80::1]",
      "[ff02::1]",
      "[::ffff:127.0.0.1]",
      "[::ffff:169.254.169.254]",
      "[2002:7f00:1::]",
    ]) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isBlockedHostname("[2606:4700:4700::1111]")).toBe(false);
    expect(isBlockedHostname("[::ffff:8.8.8.8]")).toBe(false);
  });
});

describe("parseIpv6", () => {
  it("expands :: shorthand to 16 bytes", () => {
    expect(parseIpv6("[::1]")?.length).toBe(16);
    expect(parseIpv6("[::1]")?.at(-1)).toBe(1);
  });

  it("parses embedded IPv4 tails", () => {
    expect(parseIpv6("::ffff:127.0.0.1")?.slice(12)).toEqual([127, 0, 0, 1]);
  });

  it("rejects non-IPv6 input", () => {
    expect(parseIpv6("example.com")).toBeNull();
    expect(parseIpv6("1.2.3.4")).toBeNull();
  });
});

describe("evaluateUrl", () => {
  it("accepts plain http/https", () => {
    expect(evaluateUrl("https://example.com/a").ok).toBe(true);
    expect(evaluateUrl("http://example.com:80/a").ok).toBe(true);
  });

  it("rejects non-http protocols", () => {
    for (const u of ["file:///etc/passwd", "gopher://example.com", "data:text/html,x"]) {
      const v = evaluateUrl(u);
      expect(v.ok, u).toBe(false);
      if (!v.ok) expect(v.reason).toBe("unsupported-protocol");
    }
  });

  it("rejects userinfo used to disguise the real host", () => {
    const v = evaluateUrl("http://example.com@169.254.169.254/latest/meta-data");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("credentials-in-url");
  });

  it("rejects non-web ports", () => {
    for (const u of ["http://example.com:22/", "http://example.com:6379/"]) {
      const v = evaluateUrl(u);
      expect(v.ok, u).toBe(false);
      if (!v.ok) expect(v.reason).toBe("blocked-port");
    }
  });

  it("blocks obfuscated IPv4 encodings normalised by the URL parser", () => {
    for (const u of [
      "http://2130706433/",
      "http://0x7f000001/",
      "http://017700000001/",
      "http://127.1/",
    ]) {
      const v = evaluateUrl(u);
      expect(v.ok, u).toBe(false);
      if (!v.ok) expect(v.reason).toBe("blocked-host");
    }
  });

  it("resolves relative locations against a base", () => {
    const v = evaluateUrl("/next", "https://example.com/start");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.url.toString()).toBe("https://example.com/next");
  });
});

/** Minimalny fetch zwracający zaplanowaną sekwencję odpowiedzi. */
function scriptedFetch(script: Record<string, Response | (() => Response)>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const entry = script[url];
    if (!entry) throw new Error(`unexpected fetch: ${url}`);
    return typeof entry === "function" ? entry() : entry;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const redirectTo = (location: string) =>
  new Response(null, { status: 302, headers: { location } });
const ok = () => new Response("<html></html>", { status: 200 });

describe("safeFetch", () => {
  it("returns the response when there is no redirect", async () => {
    const { impl, calls } = scriptedFetch({ "https://example.com/": ok() });
    const res = await safeFetch("https://example.com/", { fetchImpl: impl });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("follows a public -> public redirect", async () => {
    const { impl } = scriptedFetch({
      "https://example.com/": redirectTo("https://elsewhere.example/final"),
      "https://elsewhere.example/final": ok(),
    });
    const res = await safeFetch("https://example.com/", { fetchImpl: impl });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.finalUrl.toString()).toBe("https://elsewhere.example/final");
  });

  it("refuses a redirect to loopback", async () => {
    const { impl, calls } = scriptedFetch({
      "https://example.com/": redirectTo("http://127.0.0.1:80/admin"),
    });
    const res = await safeFetch("https://example.com/", { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("blocked-host");
    // Kluczowe: nigdy nie doszło do połączenia z adresem prywatnym.
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("refuses a redirect to cloud metadata", async () => {
    const { impl } = scriptedFetch({
      "https://example.com/": redirectTo("http://169.254.169.254/latest/meta-data/"),
    });
    const res = await safeFetch("https://example.com/", { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("blocked-host");
  });

  it("refuses a redirect to IPv6 loopback", async () => {
    const { impl } = scriptedFetch({
      "https://example.com/": redirectTo("http://[::1]/"),
    });
    const res = await safeFetch("https://example.com/", { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("blocked-host");
  });

  it("stops after the redirect limit", async () => {
    const { impl } = scriptedFetch({
      "https://a.example/": redirectTo("https://b.example/"),
      "https://b.example/": redirectTo("https://c.example/"),
      "https://c.example/": redirectTo("https://d.example/"),
      "https://d.example/": redirectTo("https://e.example/"),
      "https://e.example/": ok(),
    });
    const res = await safeFetch("https://a.example/", { fetchImpl: impl, maxRedirects: 3 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("too-many-redirects");
  });

  it("breaks redirect loops", async () => {
    const { impl } = scriptedFetch({
      "https://a.example/": redirectTo("https://b.example/"),
      "https://b.example/": redirectTo("https://a.example/"),
    });
    const res = await safeFetch("https://a.example/", { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("too-many-redirects");
  });

  it("rejects the initial url before any network call", async () => {
    const { impl, calls } = scriptedFetch({});
    const res = await safeFetch("http://192.168.0.1/", { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("blocked-host");
    expect(calls).toEqual([]);
  });
});
