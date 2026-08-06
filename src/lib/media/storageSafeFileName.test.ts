import { describe, expect, it } from "vitest";
import { storageSafeFileName } from "./storageSafeFileName";

describe("storageSafeFileName", () => {
  it("transliterates Polish and drops spaces/parens for Supabase keys", () => {
    expect(
      storageSafeFileName(
        "Wniosek o pozwolenie na użytkowanie (PB-17).docx",
      ),
    ).toBe("Wniosek_o_pozwolenie_na_uzytkowanie_PB-17.docx");
  });

  it("keeps simple ascii names", () => {
    expect(storageSafeFileName("raport.pdf")).toBe("raport.pdf");
  });

  it("falls back when empty", () => {
    expect(storageSafeFileName("   ")).toBe("plik");
  });
});
