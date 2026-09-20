import { describe, expect, it } from "vitest";
import { sanitizeDownloadFileName } from "./downloadRemoteFile";

describe("sanitizeDownloadFileName", () => {
  it("zostawia zwykłą nazwę", () => {
    expect(sanitizeDownloadFileName("foto.jpg")).toBe("foto.jpg");
  });

  it("usuwa znaki niebezpieczne dla systemu plików", () => {
    expect(sanitizeDownloadFileName('a/b:c*"?.jpg')).toBe("a_b_c_.jpg");
  });

  it("daje domyślną nazwę przy pustym wejściu", () => {
    expect(sanitizeDownloadFileName("")).toBe("zdjecie.jpg");
    expect(sanitizeDownloadFileName("   ")).toBe("zdjecie.jpg");
  });
});
