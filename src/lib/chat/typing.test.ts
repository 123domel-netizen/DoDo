import { describe, expect, it } from "vitest";
import { typingLabel } from "@/lib/chat/typing";

describe("typingLabel", () => {
  it("brak piszących → null", () => {
    expect(typingLabel([])).toBeNull();
    expect(typingLabel([""])).toBeNull();
  });

  it("jedna i dwie osoby", () => {
    expect(typingLabel(["Ala"])).toBe("Ala pisze…");
    expect(typingLabel(["Ala", "Ola"])).toBe("Ala i Ola piszą…");
  });

  it("duplikaty scala, powyżej dwóch osób zbiorczo", () => {
    expect(typingLabel(["Ala", "Ala"])).toBe("Ala pisze…");
    expect(typingLabel(["Ala", "Ola", "Ela"])).toBe("Kilka osób pisze…");
  });
});
