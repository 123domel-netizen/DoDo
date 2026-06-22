export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

export const ATTACHMENT_TOO_LARGE_MESSAGE =
  "Plik jest za duży. Maksymalny rozmiar to 5 MB.";

export function isAttachmentTooLarge(file: File): boolean {
  return file.size > MAX_ATTACHMENT_SIZE_BYTES;
}
