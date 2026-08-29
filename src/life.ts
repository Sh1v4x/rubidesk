/**
 * Vie spontanée : Rubilax commente ce qu'il voit sans qu'on lui demande.
 * Boulot tardif, météo du matin, batterie qui agonise, et de temps en
 * temps une vanne gratuite — avec des garde-fous pour ne jamais spammer
 * (une fois par nuit / par jour / par épisode, et un long délai entre
 * deux vannes).
 */
import { replies } from "./replies";

export interface LifeDeps {
  say(text: string): void;
  getCity(): string | null;
  /** description courte du temps actuel (« 12 degrés, pluie ») ou null */
  fetchWeather(city: string): Promise<string | null>;
  getBattery(): { level: number; charging: boolean } | null;
  /** vrai si Rubilax est déjà occupé (écoute, bulle affichée…) */
  isBusy(): boolean;
}

const KEYS = {
  quip: "rubilax.life.lastQuip",
  night: "rubilax.life.night",
  morning: "rubilax.life.morning",
  battery: "rubilax.life.lastBattery",
  seen: "rubilax.life.lastSeen",
};

function since(key: string): number {
  return Date.now() - Number(localStorage.getItem(key) ?? 0);
}

function stamp(key: string): void {
  localStorage.setItem(key, String(Date.now()));
}

/** 23 h et 2 h du matin appartiennent à la même « nuit ». */
function nightKey(now: Date): string {
  const d = new Date(now);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return `n${d.toDateString()}`;
}

let hoursAway = 0;

/** Heures entières passées sans ouvrir Rubilax, mesurées une fois au démarrage. */
export function absenceHours(): number {
  return hoursAway;
}

export function initLife(deps: LifeDeps): void {
  // rancune d'abandon : on mesure l'absence avant d'estampiller la présence
  const lastSeen = Number(localStorage.getItem(KEYS.seen) ?? 0);
  if (lastSeen > 0) hoursAway = Math.floor((Date.now() - lastSeen) / 3_600_000);
  stamp(KEYS.seen);
  window.setInterval(() => stamp(KEYS.seen), 60_000);

  window.setTimeout(() => void tick(deps), 90_000);
  window.setInterval(() => void tick(deps), 5 * 60_000);
}

async function tick(deps: LifeDeps): Promise<void> {
  if (deps.isBusy()) return;
  const now = new Date();
  const hour = now.getHours();

  // batterie qui agonise (hors charge) : une pique par épisode de 2 h
  const bat = deps.getBattery();
  if (bat && bat.level >= 0 && bat.level <= 15 && !bat.charging) {
    if (since(KEYS.battery) > 2 * 3_600_000) {
      stamp(KEYS.battery);
      deps.say(replies.lifeLowBattery(bat.level));
      return;
    }
  }

  // boulot tardif : une remarque par nuit
  if ((hour >= 23 || hour < 5) && localStorage.getItem(KEYS.night) !== nightKey(now)) {
    localStorage.setItem(KEYS.night, nightKey(now));
    deps.say(replies.lifeLateNight());
    return;
  }

  // météo du matin : une fois par jour, entre 6 h et 11 h, si ville connue
  if (hour >= 6 && hour < 11 && localStorage.getItem(KEYS.morning) !== now.toDateString()) {
    localStorage.setItem(KEYS.morning, now.toDateString());
    const city = deps.getCity();
    if (city) {
      const weather = await deps.fetchWeather(city);
      if (weather) {
        deps.say(replies.lifeMorning(weather));
        return;
      }
    }
  }

  // vanne gratuite, toutes les 45 à 90 minutes de présence
  if (since(KEYS.quip) > (45 + Math.random() * 45) * 60_000) {
    stamp(KEYS.quip);
    deps.say(replies.lifeQuip());
  }
}
