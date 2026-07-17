/**
 * CHAT5-VOICE: minimalistyczne wiadomości głosowe — nagraj, wyślij, odsłuchaj.
 * MediaRecorder: Chrome/Android → audio/webm (opus), Safari/iOS → audio/mp4.
 */

export interface VoiceRecording {
  file: File;
  durationSec: number;
}

export interface ActiveRecorder {
  stop: () => Promise<VoiceRecording | null>;
  cancel: () => void;
}

export function voiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export async function startVoiceRecording(): Promise<ActiveRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const cleanup = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  recorder.start(250);

  return {
    stop: async () => {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      cleanup();
      if (cancelled || !chunks.length) return null;
      const mime = recorder.mimeType || mimeType || "audio/webm";
      const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const file = new File(
        chunks,
        `glosowka-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFor(mime)}`,
        { type: mime.split(";")[0] },
      );
      return { file, durationSec };
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
    },
  };
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
