/**
 * Dźwięk + wibracja przy nowej wiadomości (jak WhatsApp / Messenger).
 * Synth przez Web Audio — bez pliku w public/.
 * Przeglądarki wymagają „odblokowania” AudioContext po geście użytkownika.
 */

let audioCtx: AudioContext | null = null;
let armed = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

/** Wywołaj po pierwszym kliknięciu / klawiszu — bez tego Chrome wycisza dźwięk. */
export function armNotifyAudio(): void {
  if (armed) return;
  armed = true;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

/** Podpięcie one-shot pod gest użytkownika (App / chat boot). */
export function installNotifyAudioArm(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const arm = () => {
    armNotifyAudio();
    window.removeEventListener("pointerdown", arm);
    window.removeEventListener("keydown", arm);
    window.removeEventListener("touchstart", arm);
  };
  window.addEventListener("pointerdown", arm, { once: true, passive: true });
  window.addEventListener("keydown", arm, { once: true });
  window.addEventListener("touchstart", arm, { once: true, passive: true });
  return () => {
    window.removeEventListener("pointerdown", arm);
    window.removeEventListener("keydown", arm);
    window.removeEventListener("touchstart", arm);
  };
}

/** Krótki dwutonowy „ping”. */
export function playMessageNotifySound(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, t0);
    master.connect(ctx.destination);

    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(1, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };

    beep(1046.5, t0, 0.09);
    beep(1318.5, t0 + 0.1, 0.12);
  } catch {
    /* autoplay / brak AudioContext */
  }
}

/** Wibracja na telefonie (PWA / przeglądarka mobilna). */
export function vibrateMessageNotify(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([28, 50, 28]);
    }
  } catch {
    /* brak Vibration API */
  }
}

export function playIncomingMessageAlert(): void {
  playMessageNotifySound();
  vibrateMessageNotify();
}
