import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

export type FileKind =
  | "pdf"
  | "sheet"
  | "doc"
  | "archive"
  | "audio"
  | "video"
  | "code"
  | "other";

export function fileExtension(fileName: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim());
  return (m?.[1] ?? "").toUpperCase();
}

/** Word / Excel / PowerPoint — kandydat do „Dodaj jako plik do edycji”. */
export function isOfficeEditableFile(mimeType: string, fileName: string): boolean {
  const mime = (mimeType || "").toLowerCase();
  const ext = fileExtension(fileName).toLowerCase();
  if (["doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx"].includes(ext)) {
    return true;
  }
  return (
    mime.includes("wordprocessingml") ||
    mime.includes("spreadsheetml") ||
    mime.includes("presentationml") ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.ms-powerpoint"
  );
}

export function classifyFile(mimeType: string, fileName: string): FileKind {
  const mime = (mimeType || "").toLowerCase();
  const ext = fileExtension(fileName).toLowerCase();

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    ["xls", "xlsx", "csv", "ods", "xlsm"].includes(ext)
  ) {
    return "sheet";
  }
  if (
    mime.includes("word") ||
    mime.includes("msword") ||
    mime.includes("document") ||
    ["doc", "docx", "odt", "rtf", "txt", "md"].includes(ext)
  ) {
    return "doc";
  }
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    mime.includes("7z") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    ["zip", "rar", "7z", "tar", "gz"].includes(ext)
  ) {
    return "archive";
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) {
    return "audio";
  }
  if (mime.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) {
    return "video";
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    ["js", "ts", "tsx", "jsx", "json", "html", "css", "py", "sql"].includes(ext)
  ) {
    return "code";
  }
  return "other";
}

export function fileKindIcon(kind: FileKind): LucideIcon {
  switch (kind) {
    case "pdf":
    case "doc":
      return FileText;
    case "sheet":
      return FileSpreadsheet;
    case "archive":
      return FileArchive;
    case "audio":
      return FileAudio;
    case "video":
      return FileVideo;
    case "code":
      return FileCode;
    default:
      return File;
  }
}

/** Kolory akcentu ikony / badge wg typu. */
export function fileKindTone(kind: FileKind): { bg: string; fg: string; badge: string } {
  switch (kind) {
    case "pdf":
      return { bg: "bg-red-500/15", fg: "text-red-400", badge: "bg-red-500 text-white" };
    case "sheet":
      return { bg: "bg-emerald-500/15", fg: "text-emerald-400", badge: "bg-emerald-600 text-white" };
    case "doc":
      return { bg: "bg-sky-500/15", fg: "text-sky-400", badge: "bg-sky-600 text-white" };
    case "archive":
      return { bg: "bg-amber-500/15", fg: "text-amber-400", badge: "bg-amber-600 text-white" };
    case "audio":
      return { bg: "bg-violet-500/15", fg: "text-violet-400", badge: "bg-violet-600 text-white" };
    case "video":
      return { bg: "bg-fuchsia-500/15", fg: "text-fuchsia-400", badge: "bg-fuchsia-600 text-white" };
    case "code":
      return { bg: "bg-orange-500/15", fg: "text-orange-400", badge: "bg-orange-600 text-white" };
    default:
      return { bg: "bg-surface-overlay", fg: "text-ink-faint", badge: "bg-ink-faint text-surface" };
  }
}

export function isPdfAttachment(mimeType: string, fileName: string): boolean {
  return classifyFile(mimeType, fileName) === "pdf";
}
