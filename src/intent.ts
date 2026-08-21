import type { HaEntity } from "./ha";

export type Action = "turn_on" | "turn_off" | "toggle";

export interface Intent {
  action: Action;
  /** Mots utiles pour retrouver l'entité ("lumiere", "salon", …), normalisés. */
  query: string[];
}

/** minuscules + sans accents */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const ON_WORDS = /\b(allume[rz]?|active[rz]?|demarre[rz]?|lance[rz]?|mets?|ouvre)\b/;
const OFF_WORDS = /\b(eteins?|eteindre|eteignez?|coupe[rz]?|arrete[rz]?|stoppe?[rz]?|desactive[rz]?|ferme)\b/;
const TOGGLE_WORDS = /\b(bascule[rz]?|toggle|inverse[rz]?)\b/;

const STOP_WORDS = new Set([
  "le", "la", "les", "l", "un", "une", "du", "de", "des", "d",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "s", "il", "te", "plait", "stp", "svp", "merci", "dans", "a", "au", "aux",
  "et", "ou", "moi", "me", "tu", "peux", "veux", "je", "rubilax",
]);

/** Mots du quotidien → domaine Home Assistant. */
const DOMAIN_SYNONYMS: Record<string, string> = {
  lumiere: "light",
  lumieres: "light",
  lampe: "light",
  lampes: "light",
  plafonnier: "light",
  led: "light",
  leds: "light",
  ventilateur: "fan",
  ventilo: "fan",
  ventilation: "fan",
  prise: "switch",
  prises: "switch",
  interrupteur: "switch",
  volet: "cover",
  volets: "cover",
  store: "cover",
  tele: "media_player",
  television: "media_player",
  enceinte: "media_player",
};

export interface TimerIntent {
  ms: number;
  label: string;
}

const TIMER_TRIGGER = /\b(rappelle|rappeler|rappel|minuteur|minuterie|timer|reveille)\b/;
const TIMER_CANCEL = /\b(annule[rz]?|arrete[rz]?|stoppe?[rz]?|coupe[rz]?)\b.*\b(minuteurs?|minuterie|rappels?|timers?)\b/;
const DURATION = /\b(\d+|une?)\s*(heures?|h|minutes?|min|mn|secondes?|sec|s)\b/g;

/** « rappelle-moi dans 20 minutes de sortir le four », « minuteur 3 min »… */
export function parseTimer(text: string): TimerIntent | "cancel" | null {
  const norm = normalize(text).replace(/[^a-z0-9 ]/g, " ");
  if (TIMER_CANCEL.test(norm)) return "cancel";
  if (!TIMER_TRIGGER.test(norm)) return null;

  let ms = 0;
  for (const m of norm.matchAll(DURATION)) {
    const n = m[1] === "un" || m[1] === "une" ? 1 : parseInt(m[1], 10);
    const unit = m[2];
    if (unit.startsWith("h")) ms += n * 3_600_000;
    else if (unit.startsWith("min") || unit === "mn") ms += n * 60_000;
    else ms += n * 1_000;
  }
  if (ms <= 0) return null;

  // le libellé = ce qui reste une fois retirés déclencheur, durées et mots outils
  const label = norm
    .replace(DURATION, " ")
    .replace(TIMER_TRIGGER, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w) && !["dans", "pour", "que", "moi"].includes(w))
    .join(" ");

  return { ms, label };
}

/** « 1 h 30 min », « 20 secondes »… pour la confirmation. */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  const h = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  if (h > 0) parts.push(`${h} heure${h > 1 ? "s" : ""}`);
  if (min > 0) parts.push(`${min} minute${min > 1 ? "s" : ""}`);
  if (s > 0) parts.push(`${s} seconde${s > 1 ? "s" : ""}`);
  return parts.join(" ") || "0 seconde";
}

export interface OpenIntent {
  kind: "url" | "app" | "search";
  target: string;
}

const OPEN_TRIGGER = /\b(?:ouvre[sz]?|ouvrir|lance[rz]?|va sur|vas sur|affiche[rz]?)\s+(.+)$/;
const SEARCH_TRIGGER = /\b(?:recherche[rz]?|cherche[rz]?)\s+(.+)$/;

/** « ouvre Spotify », « va sur youtube.com », « recherche la météo »… */
export function parseOpen(text: string): OpenIntent | null {
  // garder les points (URLs), convertir « youtube point com » dicté à la voix
  const norm = normalize(text)
    .replace(/\s+point\s+(com|fr|net|org|io|tv|gg|dev|app)\b/g, ".$1")
    .replace(/[^a-z0-9. -]/g, " ");

  const search = norm.match(SEARCH_TRIGGER);
  if (search) {
    const target = search[1]
      .replace(/\b(sur\s+)?(google|internet|le web)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return target ? { kind: "search", target } : null;
  }

  const m = norm.match(OPEN_TRIGGER);
  if (!m) return null;
  const words = m[1].split(/\s+/).filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  // « ouvre les volets » etc. : c'est de la domotique, pas une application
  if (words.some((w) => w in DOMAIN_SYNONYMS)) return null;

  const url = words.find((w) => /\.[a-z]{2,}/.test(w));
  if (url) return { kind: "url", target: url };
  return { kind: "app", target: words.join(" ") };
}

export function parseIntent(text: string): Intent | null {
  const norm = normalize(text).replace(/[^a-z0-9 ]/g, " ");
  let action: Action | null = null;
  if (ON_WORDS.test(norm)) action = "turn_on";
  else if (OFF_WORDS.test(norm)) action = "turn_off";
  else if (TOGGLE_WORDS.test(norm)) action = "toggle";
  if (!action) return null;

  const query = norm
    .replace(ON_WORDS, " ")
    .replace(OFF_WORDS, " ")
    .replace(TOGGLE_WORDS, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  return { action, query };
}

const CONTROLLABLE_DOMAINS = new Set([
  "light", "switch", "fan", "cover", "media_player", "climate", "humidifier", "scene", "script",
]);

export interface Match {
  entity: HaEntity;
  score: number;
}

/**
 * Un mot de la requête matche un mot du nom d'entité s'il est identique,
 * ou si l'un est un préfixe de l'autre (≥ 4 lettres) — tolère le pluriel,
 * les diminutifs ("ventilo") et les petites variations de transcription.
 */
function wordMatches(haystackWords: string[], word: string): boolean {
  return haystackWords.some(
    (h) =>
      h === word ||
      (word.length >= 4 && h.startsWith(word)) ||
      (h.length >= 4 && word.startsWith(h)),
  );
}

/**
 * Trouve la meilleure entité pour la requête : chaque mot qui apparaît dans le
 * friendly_name ou l'entity_id compte, un mot-synonyme de domaine compte pour
 * le domaine correspondant.
 */
export function findEntity(query: string[], entities: HaEntity[]): Match | null {
  let best: Match | null = null;

  for (const entity of entities) {
    const domain = entity.entity_id.split(".")[0];
    if (!CONTROLLABLE_DOMAINS.has(domain)) continue;

    const haystack = normalize(
      `${entity.attributes.friendly_name ?? ""} ${entity.entity_id.replace(/[._]/g, " ")}`,
    );
    const haystackWords = haystack.split(/\s+/).filter((w) => w.length > 0);

    let score = 0;
    for (const word of query) {
      if (DOMAIN_SYNONYMS[word] === domain) score += 1;
      else if (wordMatches(haystackWords, word)) score += 2;
    }
    if (score === 0) continue;

    if (
      !best ||
      score > best.score ||
      (score === best.score && haystack.length < normalize(best.entity.attributes.friendly_name ?? best.entity.entity_id).length)
    ) {
      best = { entity, score };
    }
  }

  // Un seul mot-domaine ("allume la lumière") sans nom de pièce est trop
  // ambigu s'il y a plusieurs candidats du même score — on prend quand même
  // le meilleur pour ce premier jet.
  return best;
}
