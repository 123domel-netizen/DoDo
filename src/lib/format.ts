import { format } from "date-fns";
import { pl } from "date-fns/locale";

export function fmt(date: Date | string, pattern: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, pattern, { locale: pl });
}

export function fmtTime(date: Date | string): string {
  return fmt(date, "HH:mm");
}

export function fmtRange(start: Date | string, end: Date | string): string {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

/** "16 czerwca", "pt 19" etc. */
export function fmtDayLabel(date: Date): string {
  return fmt(date, "EEEEEE d");
}

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

/** Returns a readable contrast color (black/white) for a hex background. */
export function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#37352f" : "#ffffff";
}

/** Light tinted background from a hex color. */
export function tint(hex: string, alpha = 0.14): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
