/**
 * Pobranie obrazu z signed URL (R2 / Storage / SharePoint).
 * Fetch → Blob omija ograniczenie `a.download` na cross-origin;
 * przy CORS otwieramy nową kartę jako awaryjną ścieżkę.
 */

export function sanitizeDownloadFileName(fileName: string): string {
  const cleaned = (fileName || "zdjecie.jpg").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return cleaned || "zdjecie.jpg";
}

export async function downloadRemoteFile(
  url: string,
  fileName: string,
): Promise<"saved" | "opened"> {
  const safeName = sanitizeDownloadFileName(fileName);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return "saved";
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    return "opened";
  }
}
