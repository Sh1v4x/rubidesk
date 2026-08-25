/**
 * Ampoule d'humeur : une lumière Home Assistant suit la forme du Fendoir.
 * Normal → blanc chaud stable ; feu → rouge/orange vacillant ;
 * air → vert/bleu vacillant (les couleurs de la lame).
 *
 * Ne touche JAMAIS à l'ampoule si le module domotique est désactivé ou si
 * aucune ampoule n'a été choisie dans les réglages.
 */
import * as ha from "./ha";
import type { SwordElement } from "./sword";

const KEY = "rubilax.moodLight";

export function getMoodLight(): string {
  return localStorage.getItem(KEY) ?? "";
}

export function setMoodLight(entityId: string): void {
  if (entityId) localStorage.setItem(KEY, entityId);
  else localStorage.removeItem(KEY);
}

/** Couleurs par forme ; deux entrées = vacillement entre les deux. */
const PALETTES: Record<SwordElement, Array<[number, number, number]>> = {
  normal: [[255, 241, 219]],
  fire: [
    [255, 58, 10],
    [255, 150, 20],
  ],
  air: [
    [125, 219, 95],
    [70, 175, 210],
  ],
};

const FLICKER_MS = 4200; // battement du vacillement

let allowed: () => boolean = () => false;
let current: SwordElement = "normal";
let phase = 0;
let timer: number | null = null;

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

async function push(): Promise<void> {
  const entity = getMoodLight();
  const cfg = ha.loadConfig();
  if (!entity || !cfg || !allowed()) {
    stopTimer();
    return;
  }
  const colors = PALETTES[current];
  const rgb = colors[phase % colors.length];
  phase += 1;
  try {
    await ha.callService(cfg, "light", "turn_on", entity, {
      rgb_color: rgb,
      transition: colors.length > 1 ? 3 : 1,
    });
  } catch {
    // HA injoignable : on retentera au prochain battement / changement
  }
}

function schedule(): void {
  stopTimer();
  if (PALETTES[current].length > 1 && allowed() && getMoodLight()) {
    timer = window.setInterval(() => void push(), FLICKER_MS);
  }
}

/** À brancher une fois : `canRun` doit dire si le module domotique est actif. */
export function init(canRun: () => boolean): void {
  allowed = canRun;
}

/** Appelé à chaque changement de forme du Fendoir (auto ou manuel). */
export function onElement(el: SwordElement): void {
  current = el;
  phase = 0;
  void push();
  schedule();
}

/** À rappeler quand le module domotique ou l'ampoule choisie change. */
export function refresh(): void {
  phase = 0;
  void push();
  schedule();
}
