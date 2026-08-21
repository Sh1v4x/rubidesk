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

export type ElementChoice = "normal" | "air" | "fire" | "auto";

/** « passe en forme feu », « mode air », « redeviens normal », « forme auto »… */
export function parseElement(text: string): ElementChoice | null {
  const norm = normalize(text).replace(/[^a-z0-9 ]/g, " ");
  if (!/\b(forme|mode|transforme|transformes?|redeviens?|element)\b/.test(norm)) return null;
  if (/\b(feu|flammes?|embrase[a-z]*)\b/.test(norm)) return "fire";
  if (/\b(air|vent)\b/.test(norm)) return "air";
  if (/\b(normale?|petite|base)\b/.test(norm)) return "normal";
  if (/\b(auto|automatique|libre)\b/.test(norm)) return "auto";
  return null;
}

export type SystemIntent =
  | { kind: "volume"; action: string }
  | { kind: "media"; action: "playpause" | "next" | "previous" }
  | { kind: "power"; action: "lock" | "sleep" }
  | { kind: "screenshot" }
  | { kind: "weather"; city: string | null; tomorrow: boolean }
  | { kind: "noteAdd"; text: string }
  | { kind: "noteList" }
  | { kind: "noteClear" }
  | { kind: "timerList" };

const MUSIC_WORDS = "(?:musique|chanson|morceau|titre|piste)";

/** Contrôle machine, musique, météo, notes, liste des minuteurs. */
export function parseSystem(text: string): SystemIntent | null {
  const norm = normalize(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // volume
  const setVol = norm.match(/\b(?:mets?|regle[rz]?)\b[^0-9]*\b(?:son|volume)\b[^0-9]*?(\d{1,3})\b/);
  if (setVol) return { kind: "volume", action: `set:${setVol[1]}` };
  if (/\b(?:monte[rz]?|augmente[rz]?|remonte[rz]?)\b.*\b(?:son|volume)\b|\bplus fort\b/.test(norm))
    return { kind: "volume", action: "up" };
  if (/\b(?:baisse[rz]?|diminue[rz]?|reduis)\b.*\b(?:son|volume)\b|\bmoins fort\b/.test(norm))
    return { kind: "volume", action: "down" };
  if (/\b(?:remets?|retablis?)\b.*\bson\b/.test(norm)) return { kind: "volume", action: "unmute" };
  if (/\bcoupe[rz]?\b.*\bson\b|\bmuet\b|\bmute\b/.test(norm)) return { kind: "volume", action: "mute" };

  // musique
  if (new RegExp(`\\bmets? (?:en )?pause\\b|\\bpause\\b.*\\b${MUSIC_WORDS}\\b|\\b(?:reprends?|relance)\\b.*\\b${MUSIC_WORDS}\\b|^play$`).test(norm))
    return { kind: "media", action: "playpause" };
  if (new RegExp(`\\b${MUSIC_WORDS}\\b.*\\bsuivante?\\b|\\bsuivante?\\b.*\\b${MUSIC_WORDS}\\b|\\bskip\\b|\\bpasse\\b.*\\b${MUSIC_WORDS}\\b`).test(norm))
    return { kind: "media", action: "next" };
  if (new RegExp(`\\b${MUSIC_WORDS}\\b.*\\bprecedente?\\b|\\bprecedente?\\b.*\\b${MUSIC_WORDS}\\b`).test(norm))
    return { kind: "media", action: "previous" };

  // machine
  if (/\bverrouille[rz]?\b/.test(norm)) return { kind: "power", action: "lock" };
  if (/\bmets?\b.*\ben veille\b/.test(norm) && /\b(pc|ordi|ordinateur|mac|machine|ecran)\b/.test(norm))
    return { kind: "power", action: "sleep" };
  if (/\b(?:capture[s]? d ?ecran|screenshot|fais une capture)\b/.test(norm)) return { kind: "screenshot" };

  // météo
  if (/\b(?:meteo|quel temps|temperature dehors|il fait (?:beau|combien|froid|chaud) dehors)\b/.test(norm)) {
    const tomorrow = /\bdemain\b/.test(norm);
    const cityMatch = norm.match(/\bmeteo\b(?:\s+(?:a|de|pour|du|sur))?\s+(.+)$/);
    let city: string | null = null;
    if (cityMatch) {
      const words = cityMatch[1]
        .split(/\s+/)
        .filter((w) => !STOP_WORDS.has(w) && !["demain", "aujourd", "hui", "a", "de", "pour"].includes(w));
      if (words.length > 0) city = words.join(" ");
    }
    return { kind: "weather", city, tomorrow };
  }

  // notes
  const note = text.match(/\bnote[sz]?\s+(?:que\s+|de\s+)?(.+)$/i);
  if (note && !/\b(lis|liste|montre|efface|supprime|vide|mes)\b/i.test(text)) {
    return { kind: "noteAdd", text: note[1].trim() };
  }
  if (/\b(?:efface[rz]?|supprime[rz]?|vide[rz]?)\b.*\bnotes?\b/.test(norm)) return { kind: "noteClear" };
  if (/\b(?:lis|liste[rz]?|montre[rz]?)\b.*\bnotes?\b|\bmes notes\b/.test(norm)) return { kind: "noteList" };

  // minuteurs en cours
  if (/\b(?:mes|les|liste[rz]? (?:mes|les)?)\b.*\b(?:minuteurs?|rappels?|timers?)\b/.test(norm))
    return { kind: "timerList" };

  return null;
}

/** Premier verbe d'action trouvé (pour hériter dans les commandes chaînées). */
export function extractActionVerb(text: string): string | null {
  const norm = normalize(text);
  const m = norm.match(ON_WORDS) ?? norm.match(OFF_WORDS) ?? norm.match(TOGGLE_WORDS);
  return m ? m[0] : null;
}

export interface EliadexIntent {
  query: string;
  view: "items" | "boss" | "dungeons" | "sublimations" | null;
}

// Déclencheurs écrits avec leurs variantes accentuées : on parse un texte
// en minuscules mais AVEC accents, pour que la requête envoyée à Eliadex
// garde les siens (« gelée royale »).
const ELIADEX_LOCATE =
  /\bo[uù]\s+(?:est|sont|se\s+trouve(?:nt)?|(?:je\s+)?(?:trouve[rz]?|farme?[rz]?|drop(?:pe)?[rz]?|r[ée]cup[èe]re[rz]?|obtiens?))\b\s*(.*)$/;
// tournure inversée : « la gelée royale, où je la trouve ? »
const ELIADEX_LOCATE_TAIL =
  /^(.+?)\s+o[uù]\s+(?:je\s+)?(?:l[ae]s?\s+)?(?:trouve[rz]?|farme?[rz]?|drop(?:pe)?[rz]?)\b/;
const ELIADEX_RECIPE = /\brecettes?\s+(?:de\s+la\s+|de\s+|du\s+|des\s+|d['e]\s*)?(.+)$/;
const ELIADEX_DIRECT = /\b(?:cherche[rz]?|recherche[rz]?|regarde[rz]?)\s+(.+?)\s+(?:sur|dans)\s+eliadex\b/;

/** « où je trouve X », « où se trouve le boss Y », « recette de Z »… → Eliadex. */
export function parseEliadex(text: string): EliadexIntent | null {
  const soft = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  let rest: string | null = null;
  let view: EliadexIntent["view"] = null;

  const direct = soft.match(ELIADEX_DIRECT);
  const recipe = soft.match(ELIADEX_RECIPE);
  const locate = soft.match(ELIADEX_LOCATE);
  const locateTail = soft.match(ELIADEX_LOCATE_TAIL);
  if (direct) rest = direct[1];
  else if (recipe) {
    rest = recipe[1];
    view = "items";
  } else if (locate) rest = locate[1];
  else if (locateTail) rest = locateTail[1];
  else return null;

  let words = rest.split(/\s+/).filter((w) => w.length > 0 && !STOP_WORDS.has(normalize(w)));
  // « où est la lumière » : la domotique reste chez Home Assistant
  if (words.some((w) => normalize(w) in DOMAIN_SYNONYMS)) return null;

  if (view === null) {
    if (words.some((w) => normalize(w) === "boss")) {
      view = "boss";
      words = words.filter((w) => normalize(w) !== "boss");
    } else if (words.some((w) => normalize(w).startsWith("donjon"))) {
      view = "dungeons";
      words = words.filter((w) => !normalize(w).startsWith("donjon"));
    } else if (words.some((w) => normalize(w).startsWith("sublimation"))) {
      view = "sublimations";
      words = words.filter((w) => !normalize(w).startsWith("sublimation"));
    }
  }

  const query = words.join(" ");
  if (!query) return null;
  return { query, view };
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
