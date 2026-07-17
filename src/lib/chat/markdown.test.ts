import { describe, expect, it } from "vitest";
import {
  extractUrls,
  firstUrl,
  isGifUrl,
  parseMarkdownLite,
} from "@/lib/chat/markdown";

describe("parseMarkdownLite", () => {
  it("czysty tekst → jeden segment", () => {
    expect(parseMarkdownLite("zwykły tekst")).toEqual([
      { type: "text", text: "zwykły tekst" },
    ]);
  });

  it("pogrubienie **x**", () => {
    const segs = parseMarkdownLite("to jest **ważne** słowo");
    expect(segs).toEqual([
      { type: "text", text: "to jest " },
      { type: "bold", text: "ważne" },
      { type: "text", text: " słowo" },
    ]);
  });

  it("kursywa *x* i _x_", () => {
    expect(parseMarkdownLite("*raz* i _dwa_")).toEqual([
      { type: "italic", text: "raz" },
      { type: "text", text: " i " },
      { type: "italic", text: "dwa" },
    ]);
  });

  it("kod inline `x` nie interpretuje wnętrza", () => {
    const segs = parseMarkdownLite("użyj `**nie bold**`");
    expect(segs).toEqual([
      { type: "text", text: "użyj " },
      { type: "code", text: "**nie bold**" },
    ]);
  });

  it("przekreślenie ~~x~~", () => {
    expect(parseMarkdownLite("~~stare~~")).toEqual([{ type: "strike", text: "stare" }]);
  });

  it("auto-link http(s)", () => {
    const segs = parseMarkdownLite("zobacz https://dodo.app/x tutaj");
    expect(segs[1]).toEqual({
      type: "link",
      text: "https://dodo.app/x",
      href: "https://dodo.app/x",
    });
  });

  it("wzmianka @Nazwa tylko dla znanych nazw (najdłuższe dopasowanie)", () => {
    const segs = parseMarkdownLite("cześć @Jan Kowalski koniec", ["Jan", "Jan Kowalski"]);
    expect(segs).toEqual([
      { type: "text", text: "cześć " },
      { type: "mention", text: "@Jan Kowalski", name: "Jan Kowalski" },
      { type: "text", text: " koniec" },
    ]);
  });

  it("@ bez znanej nazwy zostaje tekstem", () => {
    expect(parseMarkdownLite("napisz @ktokolwiek", ["Jan"])).toEqual([
      { type: "text", text: "napisz @ktokolwiek" },
    ]);
  });

  it("nie myli mnożenia a*b*c z kursywą przy przylegających znakach", () => {
    const segs = parseMarkdownLite("2*2*2");
    expect(segs).toEqual([{ type: "text", text: "2*2*2" }]);
  });
});

describe("extractUrls / firstUrl / isGifUrl", () => {
  it("wyciąga i deduplikuje URL-e", () => {
    expect(extractUrls("a https://x.pl b https://x.pl c https://y.pl")).toEqual([
      "https://x.pl",
      "https://y.pl",
    ]);
  });

  it("firstUrl zwraca pierwszy albo null", () => {
    expect(firstUrl("nic tu nie ma")).toBeNull();
    expect(firstUrl("link https://a.pl/x")).toBe("https://a.pl/x");
  });

  it("isGifUrl rozpoznaje .gif i znanych dostawców", () => {
    expect(isGifUrl("https://media.tenor.com/abc.gif")).toBe(true);
    expect(isGifUrl("https://foo.com/x.gif?a=1")).toBe(true);
    expect(isGifUrl("https://example.com/page")).toBe(false);
  });
});
