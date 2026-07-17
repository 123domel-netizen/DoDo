import { describe, expect, it } from "vitest";
import {
  applyMention,
  collectMentions,
  mentionQueryAt,
  mentionSuggestions,
  mentionsUser,
} from "@/lib/chat/mentions";

const members = [
  { userId: "u1", displayName: "Jan" },
  { userId: "u2", displayName: "Ola Nowak" },
  { userId: "u3", displayName: "Kasia" },
];

describe("collectMentions", () => {
  it("zbiera id oznaczonych członków (case-insensitive)", () => {
    expect(collectMentions("hej @jan i @Ola Nowak", members)).toEqual(["u1", "u2"]);
  });

  it("pomija nazwy niebędące pełną wzmianką (granica słowa)", () => {
    // "@Janusz" nie jest wzmianką "Jan"
    expect(collectMentions("pisze @Janusz", members)).toEqual([]);
  });

  it("nie duplikuje przy wielokrotnym oznaczeniu", () => {
    expect(collectMentions("@Kasia @Kasia", members)).toEqual(["u3"]);
  });

  it("pusta lista gdy brak wzmianek", () => {
    expect(collectMentions("zwykły tekst", members)).toEqual([]);
  });
});

describe("mentionQueryAt", () => {
  it("wykrywa aktywne zapytanie po @ na początku", () => {
    expect(mentionQueryAt("@Ja", 3)).toEqual({ start: 0, query: "Ja" });
  });

  it("wykrywa @ po spacji", () => {
    expect(mentionQueryAt("hej @Ol", 7)).toEqual({ start: 4, query: "Ol" });
  });

  it("brak, gdy @ przylega do słowa (e-mail)", () => {
    expect(mentionQueryAt("mail@x", 6)).toBeNull();
  });

  it("brak, gdy zapytanie zawiera nową linię", () => {
    expect(mentionQueryAt("@Jan\ncos", 8)).toBeNull();
  });
});

describe("mentionSuggestions", () => {
  it("filtruje po zapytaniu i wyklucza mnie", () => {
    expect(mentionSuggestions(members, "a", "u1").map((m) => m.userId)).toEqual([
      "u2",
      "u3",
    ]);
  });

  it("puste zapytanie → wszyscy poza mną", () => {
    expect(mentionSuggestions(members, "", "u2").map((m) => m.userId)).toEqual([
      "u1",
      "u3",
    ]);
  });
});

describe("applyMention", () => {
  it("wstawia wybraną nazwę i przesuwa caret za nią", () => {
    const res = applyMention("hej @Ol", 7, { start: 4, query: "Ol" }, "Ola Nowak");
    expect(res.text).toBe("hej @Ola Nowak ");
    expect(res.caret).toBe(res.text.length);
  });
});

describe("mentionsUser", () => {
  it("true tylko gdy id na liście", () => {
    expect(mentionsUser(["u1", "u2"], "u2")).toBe(true);
    expect(mentionsUser(["u1"], "u3")).toBe(false);
    expect(mentionsUser(undefined, "u1")).toBe(false);
    expect(mentionsUser(["u1"], null)).toBe(false);
  });
});
