/** Voix de Rubilax : TTS système via speechSynthesis, voix grave, en français. */

import { invoke } from "@tauri-apps/api/core";

/** Suspend le mot d'éveil pendant que Rubilax parle (anti-larsen). */
function pauseWake(paused: boolean): void {
  void invoke("wake_pause", { paused }).catch(() => {});
}

const MUTE_KEY = "rubilax.muted";

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  if (muted) speechSynthesis.cancel();
}

let frVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (frVoice) return frVoice;
  const voices = speechSynthesis.getVoices();
  frVoice =
    voices.find((v) => v.lang.startsWith("fr") && /thomas|paul|henri/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("fr")) ??
    null;
  return frVoice;
}

// Les voix se chargent parfois en asynchrone.
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.onvoiceschanged = () => pickVoice();
}

export function speak(text: string, onStart?: () => void, onEnd?: () => void): void {
  if (typeof speechSynthesis === "undefined") {
    onStart?.();
    onEnd?.();
    return;
  }
  if (isMuted()) {
    // voix coupée : la bulle reste, on simule la durée de lecture
    onStart?.();
    window.setTimeout(() => onEnd?.(), Math.min(4000, 900 + text.length * 45));
    return;
  }
  speechSynthesis.cancel();
  pauseWake(true);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.pitch = 0.4; // shushu grognon
  utterance.rate = 0.95;
  const done = (): void => {
    // petite marge pour l'écho de la pièce avant de rouvrir les oreilles
    window.setTimeout(() => pauseWake(false), 400);
    onEnd?.();
  };
  utterance.onstart = () => onStart?.();
  utterance.onend = done;
  utterance.onerror = done;
  speechSynthesis.speak(utterance);
}
