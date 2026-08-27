import "./styles.css";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sword, type SwordState } from "./sword";
import { speak, isMuted, setMuted } from "./speech";
import { replies, easterEgg } from "./replies";
import {
  parseIntent,
  findEntity,
  normalize,
  parseTimer,
  parseOpen,
  parseSystem,
  parseEliadex,
  parseElement,
  extractActionVerb,
  formatDuration,
  type Action,
  type SystemIntent,
  type EliadexIntent,
} from "./intent";
import { checkForUpdates } from "./updater";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  cancel as cancelNotification,
  Schedule,
} from "@tauri-apps/plugin-notification";

const IS_ANDROID = navigator.userAgent.includes("Android");
if (IS_ANDROID) document.body.classList.add("android");

const notifId = (id: number): number => Math.abs(id % 2_000_000_000);

async function ensureNotifPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}
import * as ha from "./ha";
import type { HaEntity } from "./ha";
import * as moodlight from "./moodlight";
import { updateShushu, SHUSHU_RED } from "./shushu";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sword = new Sword(document.querySelector("#sword-svg") as SVGSVGElement);
const bubble = $("bubble");
const input = $<HTMLInputElement>("input");
const micBtn = $("btn-mic");
const settingsPanel = $("settings");
const settingsStatus = $("settings-status");
const urlInput = $<HTMLInputElement>("ha-url");
const tokenInput = $<HTMLInputElement>("ha-token");

let bubbleTimer: number | undefined;
let statesCache: { at: number; entities: HaEntity[] } | null = null;

// ---- modules activables ----

interface Features {
  domotique: boolean;
  apps: boolean;
  eliadex: boolean;
}

const FEATURES_KEY = "rubilax.features";

function loadFeatures(): Features {
  try {
    return { domotique: true, apps: true, eliadex: true, ...JSON.parse(localStorage.getItem(FEATURES_KEY) ?? "{}") };
  } catch {
    return { domotique: true, apps: true, eliadex: true };
  }
}

const features = loadFeatures();

// l'ampoule d'humeur suit la forme — seulement si la domotique est active
// ET que l'interrupteur « Humeurs lumineuses » n'est pas coupé
const MOODLIGHT_ON_KEY = "rubilax.moodLightOn";
moodlight.init(
  () => features.domotique && localStorage.getItem(MOODLIGHT_ON_KEY) !== "0",
);
sword.onElementChange = (el) => {
  moodlight.onElement(el);
  // en forme monstre, la taille et la couleur se rafraîchissent tout de suite
  if (el === "shushu") void pollBattery();
};

function setFeature(key: keyof Features, on: boolean): void {
  features[key] = on;
  localStorage.setItem(FEATURES_KEY, JSON.stringify(features));
  refreshModuleButtons();
  moodlight.refresh(); // domotique coupée → on lâche l'ampoule
}

function refreshModuleButtons(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#modules button")) {
    btn.classList.toggle("active", features[btn.dataset.mod as keyof Features]);
  }
  // les sections de config n'apparaissent que si leur module est actif
  document.getElementById("ha-section")?.classList.toggle("hidden", !features.domotique);
  document.getElementById("eliadex-section")?.classList.toggle("hidden", !features.eliadex);
}

// ---- minuteurs persistants ----

interface StoredTimer {
  id: number;
  fireAt: number;
  label: string;
}

const TIMERS_KEY = "rubilax.timers";
let timerSeq = Date.now();
let storedTimers: StoredTimer[] = [];
const timerHandles = new Map<number, number>();

function saveTimers(): void {
  localStorage.setItem(TIMERS_KEY, JSON.stringify(storedTimers));
}

function armTimer(timer: StoredTimer): void {
  const handle = window.setTimeout(() => {
    storedTimers = storedTimers.filter((t) => t.id !== timer.id);
    timerHandles.delete(timer.id);
    saveTimers();
    sword.set("wake");
    window.setTimeout(() => say(replies.timerFired(timer.label), "angry"), 900);
  }, Math.max(0, timer.fireAt - Date.now()));
  timerHandles.set(timer.id, handle);

  // sur Android, une vraie notification système : elle sonne même app fermée
  if (IS_ANDROID) {
    void ensureNotifPermission().then((granted) => {
      if (!granted) return;
      try {
        sendNotification({
          id: notifId(timer.id),
          title: "Rubilax",
          body: `⏰ ${timer.label || "Minuteur"} — c'est l'heure, mortel !`,
          schedule: Schedule.at(new Date(timer.fireAt)),
        });
      } catch (e) {
        console.error(e);
      }
    });
  }
}

function scheduleTimer(ms: number, label: string, quiet = false): void {
  const timer: StoredTimer = { id: ++timerSeq, fireAt: Date.now() + ms, label };
  storedTimers.push(timer);
  saveTimers();
  armTimer(timer);
  if (!quiet) say(replies.timerSet(formatDuration(ms)), "success");
}

function cancelTimer(id: number): void {
  const handle = timerHandles.get(id);
  if (handle !== undefined) window.clearTimeout(handle);
  timerHandles.delete(id);
  storedTimers = storedTimers.filter((t) => t.id !== id);
  saveTimers();
  if (IS_ANDROID) void cancelNotification([notifId(id)]).catch(() => {});
}

function cancelAllTimers(): number {
  const count = storedTimers.length;
  for (const handle of timerHandles.values()) window.clearTimeout(handle);
  timerHandles.clear();
  storedTimers = [];
  saveTimers();
  return count;
}

/** Recharge les minuteurs sauvegardés ; signale ceux qui ont sonné dans le vide. */
function restoreTimers(): void {
  try {
    storedTimers = JSON.parse(localStorage.getItem(TIMERS_KEY) ?? "[]") as StoredTimer[];
  } catch {
    storedTimers = [];
  }
  const now = Date.now();
  const missed = storedTimers.filter((t) => t.fireAt <= now);
  storedTimers = storedTimers.filter((t) => t.fireAt > now);
  saveTimers();
  for (const t of storedTimers) armTimer(t);
  if (missed.length > 0) {
    const labels = missed.map((t) => t.label || "sans nom").join(", ");
    window.setTimeout(() => say(replies.missedTimers(labels), "error"), 4000);
  }
}

/** Affiche la bulle et fait parler Rubilax, avec l'état du Fendoir assorti. */
function say(text: string, state: SwordState = "success"): void {
  window.clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  speak(
    text,
    () => sword.set(state),
    () => {
      sword.set("idle");
      bubbleTimer = window.setTimeout(() => bubble.classList.add("hidden"), 2500);
    },
  );
}

async function getEntities(cfg: ha.HaConfig): Promise<HaEntity[]> {
  if (statesCache && Date.now() - statesCache.at < 30_000) return statesCache.entities;
  const entities = await ha.getStates(cfg);
  statesCache = { at: Date.now(), entities };
  return entities;
}

const ACTION_SERVICE: Record<Action, string> = {
  turn_on: "turn_on",
  turn_off: "turn_off",
  toggle: "toggle",
};

/** Sites courants qu'on peut demander sans TLD (« ouvre youtube »). */
const KNOWN_SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  maps: "https://maps.google.com",
  netflix: "https://www.netflix.com",
  twitch: "https://www.twitch.tv",
  github: "https://github.com",
  wikipedia: "https://fr.wikipedia.org",
  amazon: "https://www.amazon.fr",
  leboncoin: "https://www.leboncoin.fr",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  deezer: "https://www.deezer.com",
  spotify: "https://open.spotify.com",
  discord: "https://discord.com/app",
  twitter: "https://x.com",
  x: "https://x.com",
  instagram: "https://www.instagram.com",
};

async function handleOpen(open: { kind: "url" | "app" | "search"; target: string }): Promise<void> {
  try {
    if (open.kind === "url") {
      await invoke("open_web", { url: `https://${open.target.replace(/^https?:\/\//, "")}` });
      say(replies.opened(open.target));
      return;
    }
    if (open.kind === "search") {
      await invoke("open_web", {
        url: `https://www.google.com/search?q=${encodeURIComponent(open.target)}`,
      });
      say(replies.searching(open.target));
      return;
    }
    // application : matching flou côté Rust, repli sur les sites connus
    try {
      const matched = await invoke<string>("open_app", { name: open.target });
      say(replies.opened(matched));
    } catch {
      const site = KNOWN_SITES[open.target.replace(/\s+/g, "")];
      if (site) {
        await invoke("open_web", { url: site });
        say(replies.opened(open.target));
      } else {
        say(replies.openFailed(open.target), "error");
      }
    }
  } catch (e) {
    console.error(e);
    say(replies.openFailed(open.target), "error");
  }
}

/** Libellés français des codes météo WMO d'Open-Meteo. */
function weatherLabel(code: number): string {
  if (code === 0) return "ciel dégagé";
  if (code <= 2) return "peu nuageux";
  if (code === 3) return "couvert";
  if (code <= 48) return "brouillard";
  if (code <= 57) return "bruine";
  if (code <= 67) return "pluie";
  if (code <= 77) return "neige";
  if (code <= 82) return "averses";
  if (code <= 86) return "averses de neige";
  return "orage";
}

const CITY_KEY = "rubilax.city";
let torchOn = false;

async function handleSystem(intent: SystemIntent): Promise<void> {
  try {
    switch (intent.kind) {
      case "volume": {
        const result = await invoke<string>("system_volume", { action: intent.action });
        say(replies.volume(result));
        return;
      }
      case "media": {
        try {
          await invoke("system_media", { action: intent.action });
          say(replies.media());
        } catch {
          say(replies.mediaFailed(), "error");
        }
        return;
      }
      case "power": {
        say(intent.action === "lock" ? replies.locking() : replies.sleeping());
        // laisser la réplique partir avant que la session ne se fige
        window.setTimeout(() => void invoke("system_power", { action: intent.action }), 1800);
        return;
      }
      case "screenshot": {
        // petite pause pour que la bulle ne soit pas sur la capture
        bubble.classList.add("hidden");
        await new Promise((r) => window.setTimeout(r, 300));
        await invoke<string>("system_screenshot");
        say(replies.screenshot());
        return;
      }
      case "weather": {
        const city = intent.city ?? localStorage.getItem(CITY_KEY);
        if (!city) {
          say(replies.askCity(), "error");
          return;
        }
        const data = await invoke<{
          city: string;
          current: { temperature_2m: number; weather_code: number };
          daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
        }>("weather", { city });
        localStorage.setItem(CITY_KEY, city);
        let text: string;
        if (intent.tomorrow) {
          const label = weatherLabel(data.daily.weather_code[1]);
          const min = Math.round(data.daily.temperature_2m_min[1]);
          const max = Math.round(data.daily.temperature_2m_max[1]);
          text = `Demain à ${data.city} : ${label}, entre ${min} et ${max} degrés.`;
        } else {
          const label = weatherLabel(data.current.weather_code);
          text = `${Math.round(data.current.temperature_2m)} degrés à ${data.city}, ${label}.`;
        }
        const grumble = /pluie|averses|orage|bruine/.test(text)
          ? " Reste dans ton trou, mortel."
          : " Profite. Moi, je ne vois rien d'ici.";
        say(text + grumble);
        return;
      }
      case "torch": {
        try {
          await invoke("system_torch", { on: intent.on });
          torchOn = intent.on;
          document
            .querySelector('.dash-card[data-dash="torch"]')
            ?.classList.toggle("on", torchOn);
          say(replies.torch(intent.on));
        } catch (e) {
          say(String(e), "error");
        }
        return;
      }
      case "noteAdd": {
        await invoke("note_add", {
          text: intent.text,
          date: new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }),
        });
        say(replies.noteAdded());
        return;
      }
      case "noteList": {
        const notes = await invoke<string[]>("note_list").catch(() => [] as string[]);
        await openBook();
        if (notes.length === 0) say(replies.notesEmpty(), "error");
        else say(`Tu as ${notes.length} note${notes.length > 1 ? "s" : ""}. Le carnet est ouvert, débrouille-toi.`);
        return;
      }
      case "noteClear": {
        await invoke("note_clear");
        say(replies.notesCleared());
        return;
      }
      case "timerList": {
        await openBook();
        if (storedTimers.length === 0) say(replies.timerListEmpty(), "error");
        else say(`${storedTimers.length} compte${storedTimers.length > 1 ? "s" : ""} en cours — c'est dans le carnet.`);
        return;
      }
    }
  } catch (e) {
    console.error(e);
    say(`Ça a raté : ${String(e)}`, "error");
  }
}

/** Applique un choix de forme (commande vocale ou paramètres). */
function applyElementChoice(
  choice: "normal" | "air" | "fire" | "shushu" | "auto",
  spoken = false,
): void {
  const noChange = choice !== "auto" && sword.currentElement === choice && sword.elementPreference === choice;
  sword.setPreference(choice);
  refreshElementButtons();
  if (spoken) say(noChange ? replies.elementAlready() : replies.elementChanged(choice));
}

function refreshElementButtons(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#element-pref button")) {
    btn.classList.toggle("active", btn.dataset.el === sword.elementPreference);
  }
}

const ELIADEX_PATH_KEY = "rubilax.eliadexPath";

/** Ouvre Eliadex sur la recherche demandée via son deep link `eliadex://`. */
async function handleEliadex(intent: EliadexIntent): Promise<void> {
  const url =
    `eliadex://search?q=${encodeURIComponent(intent.query)}` +
    (intent.view ? `&view=${intent.view}` : "");
  try {
    // le deep link lance Eliadex s'il est fermé, et route s'il est ouvert
    await invoke("open_web", { url });
    say(replies.eliadexOpened(intent.query));
    return;
  } catch {
    // schéma inconnu : Eliadex absent, ou version antérieure aux deep links
  }
  // repli : le chemin choisi par l'utilisateur dans les réglages…
  const customPath = (localStorage.getItem(ELIADEX_PATH_KEY) ?? "").trim();
  if (customPath) {
    try {
      await invoke("open_path", { path: customPath });
      say(replies.eliadexOldVersion(intent.query), "error");
      return;
    } catch (e) {
      console.error(e);
    }
  }
  // …sinon la détection automatique
  try {
    await invoke("open_app", { name: "eliadex" });
    say(replies.eliadexOldVersion(intent.query), "error");
  } catch {
    say(replies.eliadexMissing(), "error");
  }
}

/** Découpe « fais A et B puis C » et exécute chaque commande, en héritant du verbe. */
async function handleInput(text: string): Promise<void> {
  const parts = text
    .split(/\s+(?:et puis|ensuite|puis|et)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) {
    await handleCommand(text);
    return;
  }
  let lastVerb: string | null = null;
  for (let part of parts) {
    const verb = extractActionVerb(part);
    if (verb) lastVerb = verb;
    else if (lastVerb) part = `${lastVerb} ${part}`;
    await handleCommand(part);
  }
}

async function handleCommand(text: string): Promise<void> {
  sword.set("think");

  // « aide » : le panneau des exemples de commandes
  if (/^\s*(?:aide|help|que sais[- ]tu faire\s*\??|tu sais faire quoi\s*\??)\s*[!?.]*\s*$/i.test(text)) {
    settingsPanel.classList.add("hidden");
    $("help").classList.remove("hidden");
    say("Voilà ce que je daigne faire. Lis, mortel.", "success");
    return;
  }

  // minuteurs et rappels
  const timer = parseTimer(text);
  if (timer === "cancel") {
    const count = cancelAllTimers();
    say(replies.timerCancelled(count), count > 0 ? "success" : "error");
    return;
  }
  if (timer) {
    scheduleTimer(timer.ms, timer.label);
    return;
  }

  // changement de forme manuel
  const element = parseElement(text);
  if (element) {
    applyElementChoice(element, true);
    return;
  }

  // contrôle machine, musique, météo, notes
  const system = parseSystem(text);
  if (system) {
    await handleSystem(system);
    return;
  }

  // Eliadex : où trouver un item, un boss, un donjon, une recette…
  const eliadex = parseEliadex(text);
  if (eliadex) {
    if (!features.eliadex) {
      say(replies.moduleDisabled("Eliadex"), "error");
      return;
    }
    await handleEliadex(eliadex);
    return;
  }

  // références Wakfu
  const egg = easterEgg(normalize(text));
  if (egg) {
    say(egg, "angry");
    return;
  }

  // applications, sites web, recherches
  const open = parseOpen(text);
  if (open) {
    if (!features.apps) {
      say(replies.moduleDisabled("L'ouverture d'applications"), "error");
      return;
    }
    await handleOpen(open);
    return;
  }

  const intent = parseIntent(text);
  if (!intent) {
    say(replies.noIntent(), "error");
    return;
  }

  if (!features.domotique) {
    say(replies.moduleDisabled("La domotique"), "error");
    return;
  }

  const cfg = ha.loadConfig();
  if (!cfg) {
    say(replies.notConfigured(), "error");
    settingsPanel.classList.remove("hidden");
    return;
  }

  let entities: HaEntity[];
  try {
    entities = await getEntities(cfg);
  } catch (e) {
    console.error(e);
    say(replies.connectionError(), "error");
    return;
  }

  const match = findEntity(intent.query, entities);
  if (!match) {
    say(replies.notFound(), "error");
    return;
  }

  const name = match.entity.attributes.friendly_name ?? match.entity.entity_id;
  try {
    // Le domaine "homeassistant" accepte turn_on/turn_off/toggle sur n'importe quelle entité.
    await ha.callService(cfg, "homeassistant", ACTION_SERVICE[intent.action], match.entity.entity_id);
  } catch (e) {
    console.error(e);
    say(replies.connectionError(), "error");
    return;
  }

  statesCache = null;
  // il obéit, mais une fois sur quatre il le fait en râlant ostensiblement
  const state: SwordState = Math.random() < 0.25 ? "angry" : "success";
  if (intent.action === "turn_on") say(replies.turnedOn(name), state);
  else if (intent.action === "turn_off") say(replies.turnedOff(name), state);
  else say(replies.toggled(name), state);
}

// ---- composer ----

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && input.value.trim()) {
    const text = input.value.trim();
    input.value = "";
    micBtn.classList.remove("listening");
    void handleInput(text);
  }
});

// ---- écoute vocale (whisper local) ----

let listeningNow = false;

void listen<number>("stt-download", (e) => {
  bubble.textContent = `Je télécharge mes oreilles… ${e.payload}%`;
  bubble.classList.remove("hidden");
});

void listen<string>("stt-status", (e) => {
  if (e.payload === "transcribing") {
    sword.set("think");
    bubble.textContent = "Mmh…";
    bubble.classList.remove("hidden");
  }
});

async function listenAndHandle(fromWake = false): Promise<void> {
  if (listeningNow) return;
  listeningNow = true;
  micBtn.classList.add("listening");
  try {
    const ready = await invoke<boolean>("stt_model_ready");
    if (!ready) {
      bubble.textContent = "Première fois : je télécharge mes oreilles (~550 Mo)…";
      bubble.classList.remove("hidden");
      await invoke("stt_download_model");
      bubble.classList.add("hidden");
    }
    if (fromWake) {
      // sursaut de réveil, puis posture d'écoute
      sword.set("wake");
      window.setTimeout(() => {
        if (listeningNow) sword.set("listen");
      }, 950);
    } else {
      sword.set("listen");
    }
    const text = (await invoke<string>("stt_listen")).trim();
    if (text) {
      input.value = text; // montre ce qui a été compris
      await handleInput(text);
    } else {
      say(replies.heardNothing(), "error");
    }
  } catch (e) {
    console.error(e);
    say(`Mes oreilles déconnent : ${String(e)}`, "error");
  } finally {
    listeningNow = false;
    micBtn.classList.remove("listening");
  }
}

micBtn.addEventListener("click", async () => {
  if (IS_ANDROID) {
    // reconnaissance vocale système (le dialogue micro d'Android)
    void invoke("voice_listen").catch(() =>
      say("Pas de reconnaissance vocale sur ce téléphone, mortel.", "error"),
    );
    return;
  }
  if (listeningNow) {
    // deuxième clic = fin d'écoute immédiate
    await invoke("stt_stop");
    return;
  }
  void listenAndHandle();
});

// ---- mot d'éveil « Rubilax » ----

const WAKE_PREF = "rubilax.wake";
const MIC_KEY = "rubilax.mic";
const wakeBtn = $("btn-wake");

async function setWakeMode(on: boolean): Promise<void> {
  if (on) {
    const ready = await invoke<boolean>("wake_model_ready");
    if (!ready) {
      bubble.textContent = "Je télécharge mes petites oreilles de veille (~60 Mo)…";
      bubble.classList.remove("hidden");
      await invoke("wake_download_model");
      bubble.classList.add("hidden");
    }
    await invoke("wake_start");
  } else {
    await invoke("wake_stop");
  }
  wakeBtn.classList.toggle("active", on);
  localStorage.setItem(WAKE_PREF, on ? "1" : "0");
}

wakeBtn.addEventListener("click", () => {
  const on = !wakeBtn.classList.contains("active");
  setWakeMode(on).catch((e) => say(`Veille vocale impossible : ${String(e)}`, "error"));
});

void listen<string>("wake-detected", () => {
  if (!listeningNow) void listenAndHandle(true);
});

// appliquer le micro choisi avant de démarrer la veille vocale
void (async () => {
  const savedMic = localStorage.getItem(MIC_KEY);
  if (savedMic) {
    await invoke("set_input_device", { name: savedMic }).catch(() => {});
  }
  if (localStorage.getItem(WAKE_PREF) === "1") {
    await setWakeMode(true).catch(console.error);
  }
})();

// ---- settings ----

$("btn-settings").addEventListener("click", () => {
  const cfg = ha.loadConfig();
  if (cfg) {
    urlInput.value = cfg.url;
    tokenInput.value = cfg.token;
  }
  eliadexPathInput.value = localStorage.getItem(ELIADEX_PATH_KEY) ?? "";
  refreshOverlaySwitch();
  void invoke<string>("automations_load")
    .then((j) => {
      const a = JSON.parse(j) as Record<string, { text?: string }>;
      $<HTMLInputElement>("auto-plug").value = a.power_connected?.text ?? "";
      $<HTMLInputElement>("auto-unplug").value = a.power_disconnected?.text ?? "";
      $<HTMLInputElement>("auto-batlow").value = a.battery_low?.text ?? "";
      $<HTMLInputElement>("auto-batok").value = a.battery_okay?.text ?? "";
    })
    .catch(() => {});
  settingsStatus.textContent = "";
  refreshElementButtons();
  refreshModuleButtons();
  refreshMoodSwitch();
  void refreshMicList();
  void populateMoodLight();
  $("help").classList.add("hidden");
  bookPanel.classList.add("hidden");
  settingsPanel.classList.toggle("hidden");
});

// ---- ampoule d'humeur ----

async function populateMoodLight(): Promise<void> {
  const select = $<HTMLSelectElement>("mood-light");
  const saved = moodlight.getMoodLight();
  select.innerHTML = `<option value="">— aucune —</option>`;
  const cfg = ha.loadConfig();
  if (!cfg) return;
  try {
    const lights = (await getEntities(cfg)).filter((e) => e.entity_id.startsWith("light."));
    for (const light of lights) {
      const opt = document.createElement("option");
      opt.value = light.entity_id;
      opt.textContent = light.attributes.friendly_name ?? light.entity_id;
      select.append(opt);
    }
    select.value = lights.some((l) => l.entity_id === saved) ? saved : "";
  } catch {
    // HA injoignable : la liste restera vide, tant pis
  }
}

$("mood-light").addEventListener("change", () => {
  const chosen = $<HTMLSelectElement>("mood-light").value;
  moodlight.setMoodLight(chosen);
  moodlight.refresh();
  settingsStatus.textContent = chosen
    ? "L'ampoule suivra mes humeurs. Pauvre ampoule."
    : "L'ampoule est libérée de mes humeurs.";
});

const moodSwitch = $("moodlight-switch");

function refreshMoodSwitch(): void {
  moodSwitch.classList.toggle("active", localStorage.getItem(MOODLIGHT_ON_KEY) !== "0");
}

moodSwitch.addEventListener("click", () => {
  const wantOn = localStorage.getItem(MOODLIGHT_ON_KEY) === "0";
  localStorage.setItem(MOODLIGHT_ON_KEY, wantOn ? "1" : "0");
  refreshMoodSwitch();
  moodlight.refresh();
  settingsStatus.textContent = wantOn
    ? "Je rejoue avec la lumière."
    : "Bon. Je laisse l'ampoule tranquille.";
});

// ---- panneau d'aide ----

$("btn-help").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  bookPanel.classList.add("hidden");
  $("help").classList.toggle("hidden");
});

for (const btn of document.querySelectorAll<HTMLButtonElement>(".panel-close")) {
  btn.addEventListener("click", () => btn.closest(".panel")?.classList.add("hidden"));
}

// ---- carnet : notes & minuteurs éditables ----

const bookPanel = $("book");

async function renderNotes(): Promise<void> {
  const list = $("notes-list");
  const notes = await invoke<string[]>("note_list").catch(() => [] as string[]);
  list.innerHTML = "";
  if (notes.length === 0) {
    list.innerHTML = '<p class="book-empty">Aucune note. Le vide. Comme sa patience.</p>';
    return;
  }
  notes.forEach((line, index) => {
    const m = line.match(/^- \[(.*?)\] (.*)$/);
    const date = m ? m[1] : "";
    const text = m ? m[2] : line.replace(/^- /, "");
    const row = document.createElement("div");
    row.className = "book-row";
    const input = document.createElement("input");
    input.className = "book-edit";
    input.value = text;
    input.addEventListener("change", () => {
      const value = input.value.trim();
      if (value) void invoke("note_update", { index, text: value }).catch(console.error);
      else void invoke("note_delete", { index }).then(() => renderNotes());
    });
    const meta = document.createElement("span");
    meta.className = "book-meta";
    meta.textContent = date;
    const del = document.createElement("button");
    del.className = "book-del";
    del.title = "Supprimer";
    del.textContent = "×";
    del.addEventListener("click", () => {
      void invoke("note_delete", { index }).then(() => renderNotes());
    });
    row.append(input, meta, del);
    list.appendChild(row);
  });
}

function renderTimers(): void {
  const list = $("timers-list");
  list.innerHTML = "";
  if (storedTimers.length === 0) {
    list.innerHTML = '<p class="book-empty">Aucun compte en cours.</p>';
    return;
  }
  const now = Date.now();
  for (const timer of [...storedTimers].sort((a, b) => a.fireAt - b.fireAt)) {
    const row = document.createElement("div");
    row.className = "book-row";
    const span = document.createElement("span");
    span.className = "book-text";
    const at = new Date(timer.fireAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    span.textContent = `${timer.label || "Minuteur"} — dans ${formatDuration(timer.fireAt - now)} (à ${at})`;
    const del = document.createElement("button");
    del.className = "book-del";
    del.title = "Annuler";
    del.textContent = "×";
    del.addEventListener("click", () => {
      cancelTimer(timer.id);
      renderTimers();
    });
    row.append(span, del);
    list.appendChild(row);
  }
}

async function openBook(): Promise<void> {
  settingsPanel.classList.add("hidden");
  $("help").classList.add("hidden");
  await renderNotes();
  renderTimers();
  bookPanel.classList.remove("hidden");
}

$("btn-note-add").addEventListener("click", async () => {
  const input = $<HTMLInputElement>("note-new");
  const text = input.value.trim();
  if (!text) return;
  await invoke("note_add", {
    text,
    date: new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }),
  }).catch(console.error);
  input.value = "";
  void renderNotes();
});

$<HTMLInputElement>("note-new").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-note-add").click();
});

$("btn-timer-add").addEventListener("click", () => {
  const minsInput = $<HTMLInputElement>("timer-mins");
  const labelInput = $<HTMLInputElement>("timer-label");
  const mins = parseInt(minsInput.value, 10);
  if (!Number.isFinite(mins) || mins <= 0) return;
  scheduleTimer(mins * 60_000, labelInput.value.trim(), true);
  minsInput.value = "";
  labelInput.value = "";
  renderTimers();
});

// compte à rebours rafraîchi tant que le carnet est ouvert
window.setInterval(() => {
  if (!bookPanel.classList.contains("hidden")) renderTimers();
}, 30_000);

// ---- chemin d'Eliadex ----

const eliadexPathInput = $<HTMLInputElement>("eliadex-path");
eliadexPathInput.addEventListener("change", () => {
  localStorage.setItem(ELIADEX_PATH_KEY, eliadexPathInput.value.trim());
});

$("btn-eliadex-browse").addEventListener("click", async () => {
  const isMac = navigator.userAgent.includes("Mac");
  const selected = await openFileDialog({
    title: "Sélectionner Eliadex",
    multiple: false,
    filters: isMac
      ? [{ name: "Application", extensions: ["app"] }]
      : [{ name: "Application", extensions: ["exe", "lnk"] }],
  }).catch(() => null);
  if (typeof selected === "string" && selected) {
    eliadexPathInput.value = selected;
    localStorage.setItem(ELIADEX_PATH_KEY, selected);
  }
});

// ---- choix du microphone ----

const micSelect = $<HTMLSelectElement>("mic-select");

async function refreshMicList(): Promise<void> {
  const saved = localStorage.getItem(MIC_KEY) ?? "";
  const devices = await invoke<string[]>("audio_inputs").catch(() => [] as string[]);
  micSelect.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Micro par défaut du système";
  micSelect.appendChild(def);
  for (const name of devices) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    micSelect.appendChild(opt);
  }
  micSelect.value = devices.includes(saved) ? saved : "";
}

micSelect.addEventListener("change", async () => {
  const name = micSelect.value;
  localStorage.setItem(MIC_KEY, name);
  await invoke("set_input_device", { name: name || null }).catch(console.error);
  // la veille vocale tient son flux micro ouvert : on la relance sur le nouveau
  if (wakeBtn.classList.contains("active")) {
    await invoke("wake_stop").catch(() => {});
    window.setTimeout(() => void invoke("wake_start").catch(console.error), 600);
  }
});

// ouvre le formulaire du site vitrine, version et OS pré-remplis
$("btn-bug").addEventListener("click", async () => {
  const version = await getVersion().catch(() => "?");
  const os = navigator.userAgent.includes("Mac") ? "macOS" : "Windows";
  void invoke("open_web", {
    url: `https://sh1v4x.github.io/rubidesk/?v=${encodeURIComponent(version)}&os=${os}#bug`,
  }).catch(console.error);
});

$("modules").addEventListener("click", (e) => {
  const mod = (e.target as HTMLElement).dataset.mod as keyof Features | undefined;
  if (mod === "domotique" || mod === "apps" || mod === "eliadex") {
    setFeature(mod, !features[mod]);
  }
});

$("element-pref").addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).dataset.el;
  if (el === "auto" || el === "normal" || el === "air" || el === "fire") {
    applyElementChoice(el);
  }
});

$("btn-save").addEventListener("click", () => {
  const url = urlInput.value.trim();
  const token = tokenInput.value.trim();
  if (!url || !token) {
    settingsStatus.textContent = "URL et token requis.";
    return;
  }
  ha.saveConfig({ url, token });
  statesCache = null;
  settingsStatus.textContent = "Enregistré.";
});

$("btn-test").addEventListener("click", async () => {
  const cfg = { url: urlInput.value.trim(), token: tokenInput.value.trim() };
  if (!cfg.url || !cfg.token) {
    settingsStatus.textContent = "URL et token requis.";
    return;
  }
  settingsStatus.textContent = "Test en cours…";
  try {
    await ha.check(cfg);
    const entities = await ha.getStates(cfg);
    settingsStatus.textContent = `Connecté — ${entities.length} entités trouvées.`;
    sword.flash("success");
  } catch (e) {
    settingsStatus.textContent = `Échec : ${String(e)}`;
  }
});

$("btn-close").addEventListener("click", () => {
  void getCurrentWindow().close();
});

// toucher l'œil : réveil brutal, puis colère
$("poke-zone").addEventListener("click", () => {
  sword.poke();
  window.setTimeout(() => {
    window.clearTimeout(bubbleTimer);
    bubble.textContent = replies.poked();
    bubble.classList.remove("hidden");
    speak(bubble.textContent, undefined, () => {
      bubbleTimer = window.setTimeout(() => bubble.classList.add("hidden"), 2000);
    });
  }, 950);
});

// ---- raccourci global & icône de la barre des menus ----

void listen("shortcut-listen", () => {
  if (listeningNow) {
    void invoke("stt_stop");
  } else {
    void listenAndHandle(true);
  }
});

// ---- mode mini ----

const MINI_PREF = "rubilax.mini";

async function setMini(on: boolean): Promise<void> {
  document.body.classList.toggle("mini", on);
  localStorage.setItem(MINI_PREF, on ? "1" : "0");
  sword.setEnv({ mini: on });
  await getCurrentWindow().setSize(new LogicalSize(340, on ? 660 : 720));
}

// ---- menu contextuel (clic droit sur la lame) ----

const ctxMenu = $("ctx-menu");

function refreshCtxLabels(): void {
  const mini = document.body.classList.contains("mini");
  (ctxMenu.querySelector('[data-action="mini"]') as HTMLElement).textContent = mini
    ? "Mode complet"
    : "Mode mini";
  (ctxMenu.querySelector('[data-action="mute"]') as HTMLElement).textContent = isMuted()
    ? "Rendre la voix"
    : "Couper la voix";
}

document.getElementById("avatar")?.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  refreshCtxLabels();
  ctxMenu.classList.remove("hidden");
  const rect = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - rect.width - 8)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - rect.height - 8)}px`;
});

window.addEventListener("click", () => ctxMenu.classList.add("hidden"));

ctxMenu.addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).dataset.action;
  ctxMenu.classList.add("hidden");
  switch (action) {
    case "book":
      void openBook();
      break;
    case "mini":
      void setMini(!document.body.classList.contains("mini"));
      break;
    case "mute":
      setMuted(!isMuted());
      sword.setEnv({ muted: isMuted() });
      break;
    case "settings":
      if (document.body.classList.contains("mini")) void setMini(false);
      settingsPanel.classList.remove("hidden");
      break;
    case "quit":
      speak(replies.quitting(), undefined, () => void getCurrentWindow().close());
      window.setTimeout(() => void getCurrentWindow().close(), 3500);
      break;
  }
});

// ---- réaction quand on le déplace ----

let lastMoveAt = 0;
let moveBurstStart = 0;
let lastDragReplyAt = 0;

void getCurrentWindow().onMoved(() => {
  const now = Date.now();
  if (now - lastMoveAt > 1000) moveBurstStart = now; // nouveau déplacement
  lastMoveAt = now;
  const dragging = now - moveBurstStart > 350;
  if (dragging && now - lastDragReplyAt > 30_000 && !speechSynthesis.speaking && !listeningNow) {
    lastDragReplyAt = now;
    say(replies.dragged(), "angry");
  }
});

// ---- onboarding (première ouverture) ----

const ONBOARD_KEY = "rubilax.onboarded";

function sayAwait(text: string, state: SwordState): Promise<void> {
  return new Promise((resolve) => {
    window.clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.classList.remove("hidden");
    speak(
      text,
      () => sword.set(state),
      () => {
        sword.set("idle");
        resolve();
      },
    );
  });
}

async function runOnboarding(): Promise<void> {
  localStorage.setItem(ONBOARD_KEY, "1");
  const steps: Array<{ text: string; el?: HTMLElement; state?: SwordState }> = [
    {
      text: "Bon. Puisqu'on est coincés ensemble, mortel, deux mots sur le fonctionnement.",
      state: "angry",
    },
    { text: "Le micro : tu cliques, tu parles, j'obéis. En râlant, mais j'obéis.", el: micBtn },
    {
      text: "La braise : allume-la et je me réveillerai quand tu diras « Hé Rubilax ».",
      el: wakeBtn,
    },
    {
      text: "L'engrenage : branche ta maison Home Assistant, que je serve à quelque chose.",
      el: $("btn-settings"),
    },
    {
      text: "Tu peux aussi écrire, si ma voix t'effraie. Minuteurs, météo, musique, applications… Allez. Au boulot.",
      el: input,
    },
  ];
  for (const step of steps) {
    step.el?.classList.add("spotlight");
    await sayAwait(step.text, step.state ?? "success");
    step.el?.classList.remove("spotlight");
  }
  bubbleTimer = window.setTimeout(() => bubble.classList.add("hidden"), 2500);
}

// ---- accueil mobile, œil flottant, automatisations (Android) ----

if (IS_ANDROID) {
  $("dashboard").classList.remove("hidden");
  $("dash-toggle").classList.remove("hidden");

  const VIEW_KEY = "rubilax.mobileView";
  if (localStorage.getItem(VIEW_KEY) === "sword") document.body.classList.add("sword-view");
  $("dash-toggle").addEventListener("click", () => {
    const swordView = document.body.classList.toggle("sword-view");
    localStorage.setItem(VIEW_KEY, swordView ? "sword" : "dash");
  });

  $("dashboard").addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".dash-card");
    switch (card?.dataset.dash) {
      case "domotique":
        input.placeholder = "Ex : allume la lumière du salon";
        input.focus();
        break;
      case "apps":
        input.value = "ouvre ";
        input.focus();
        break;
      case "timers":
      case "notes":
        void openBook();
        break;
      case "meteo":
        void handleInput("quel temps aujourd'hui");
        break;
      case "torch":
        void handleSystem({ kind: "torch", on: !torchOn });
        break;
      case "help":
        settingsPanel.classList.add("hidden");
        bookPanel.classList.add("hidden");
        $("help").classList.remove("hidden");
        break;
      case "settings":
        $("btn-settings").click();
        break;
    }
  });

  // œil flottant relancé au démarrage s'il était actif
  if (localStorage.getItem("rubilax.overlay") === "1") {
    void invoke("overlay_set", { active: true }).catch(() => {});
  }

  // config HA déposée dans le dossier privé de l'app (import par câble) :
  // appliquée puis consommée au démarrage
  void invoke<string | null>("config_take_pending")
    .then((raw) => {
      if (!raw) return;
      const got = JSON.parse(raw) as { url?: string; token?: string; moodLight?: string };
      if (!got.url || !got.token) return;
      ha.saveConfig({ url: got.url, token: got.token });
      if (got.moodLight !== undefined) moodlight.setMoodLight(got.moodLight);
      statesCache = null;
      moodlight.refresh();
      say("Configuration reçue. Ta maison m'obéit aussi depuis ce téléphone, maintenant.");
    })
    .catch(() => {});

  // commande dictée (appui long sur l'œil ou bouton micro) : relevée quand
  // l'app revient au premier plan, plus quelques relances au démarrage
  let voiceBusy = false;
  const pollVoice = async (): Promise<void> => {
    if (voiceBusy) return;
    voiceBusy = true;
    try {
      const text = await invoke<string | null>("voice_take_pending");
      if (text) {
        input.value = text; // montre ce qui a été compris
        sword.set("listen");
        await handleInput(text);
      }
    } catch {
      // pont natif indisponible : tant pis pour cette fois
    } finally {
      voiceBusy = false;
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void pollVoice();
  });
  window.addEventListener("focus", () => void pollVoice());
  for (const delay of [800, 2000, 4000, 7000, 11000]) {
    window.setTimeout(() => void pollVoice(), delay);
  }

  // vérification au démarrage, puis au retour au premier plan (une app
  // « rouverte » depuis les récents ne redémarre pas : sans ça, jamais
  // de nouvelle vérification)
  window.setTimeout(() => void androidUpdateCheck(), 5000);
  const UPDATE_TS_KEY = "rubilax.lastUpdateCheck";
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const last = Number(localStorage.getItem(UPDATE_TS_KEY) ?? 0);
    if (Date.now() - last < 6 * 3600_000) return;
    localStorage.setItem(UPDATE_TS_KEY, String(Date.now()));
    void androidUpdateCheck();
  });
}

// mise à jour maison Android : pas de plugin updater sur mobile — on compare
// à la dernière release GitHub et on ouvre le téléchargement du nouvel APK
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function androidUpdateCheck(): Promise<"found" | "none" | "error"> {
  try {
    const current = await getVersion();
    const res = await fetch("https://api.github.com/repos/Sh1v4x/rubidesk/releases/latest");
    const rel = (await res.json()) as {
      tag_name?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const latest = (rel.tag_name ?? "").replace(/^v/, "");
    if (!latest || !isNewerVersion(latest, current)) return "none";
    const apk = (rel.assets ?? []).find((a) => a.name.endsWith(".apk"));
    if (!apk) return "none";
    say(replies.updateFound(latest));
    // le navigateur télécharge l'APK ; Android propose ensuite l'installation
    window.setTimeout(() => void invoke("open_web", { url: apk.browser_download_url }), 2600);
    return "found";
  } catch {
    // hors ligne : on retentera plus tard
    return "error";
  }
}

const overlaySwitch = $("overlay-switch");

function refreshOverlaySwitch(): void {
  overlaySwitch.classList.toggle("active", localStorage.getItem("rubilax.overlay") === "1");
}

overlaySwitch.addEventListener("click", async () => {
  const want = localStorage.getItem("rubilax.overlay") !== "1";
  try {
    await invoke("overlay_set", { active: want });
    localStorage.setItem("rubilax.overlay", want ? "1" : "0");
    settingsStatus.textContent = want
      ? "L'œil flotte. Touche : ouvrir. Appui long : lui parler. Il se range ici."
      : "Œil rangé.";
  } catch (e) {
    settingsStatus.textContent =
      String(e) === "permission"
        ? "Accorde « Superposition » à Rubidesk dans l'écran ouvert, puis réactive ici."
        : `Impossible : ${String(e)}`;
  }
  refreshOverlaySwitch();
});

async function resolveAutomation(text: string): Promise<Record<string, string> | null> {
  const t = text.trim();
  if (!t) return null;
  const cfg = ha.loadConfig();
  if (!cfg) throw new Error("configure Home Assistant d'abord");
  const intent = parseIntent(t);
  if (!intent) throw new Error(`commande incomprise : « ${t} »`);
  const entities = await getEntities(cfg);
  const match = findEntity(intent.query, entities);
  if (!match) throw new Error(`appareil introuvable : « ${t} »`);
  return {
    text: t,
    url: cfg.url,
    token: cfg.token,
    domain: "homeassistant",
    service: ACTION_SERVICE[intent.action],
    entity_id: match.entity.entity_id,
  };
}

$("btn-auto-save").addEventListener("click", async () => {
  try {
    const config: Record<string, unknown> = {};
    const rules: Array<[string, string]> = [
      ["auto-plug", "power_connected"],
      ["auto-unplug", "power_disconnected"],
      ["auto-batlow", "battery_low"],
      ["auto-batok", "battery_okay"],
    ];
    for (const [inputId, key] of rules) {
      const rule = await resolveAutomation($<HTMLInputElement>(inputId).value);
      if (rule) config[key] = rule;
    }
    await invoke("automations_save", { json: JSON.stringify(config) });
    settingsStatus.textContent =
      "Automatisations enregistrées. App fermée, l'œil flottant doit être actif pour qu'elles agissent.";
  } catch (e) {
    settingsStatus.textContent = `Automatisations : ${e instanceof Error ? e.message : String(e)}`;
  }
});

// ---- Shushu : la batterie fait évoluer le monstre, l'ampoule le colore ----

let shushuTint = SHUSHU_RED;

/** Couleur des marques : celle de l'ampoule d'humeur si la domotique est
 *  active et l'ampoule allumée en couleur — sinon le rouge de Rubilax. */
async function shushuAccent(): Promise<string> {
  if (!features.domotique) return SHUSHU_RED;
  const entity = moodlight.getMoodLight();
  const cfg = ha.loadConfig();
  if (!entity || !cfg) return SHUSHU_RED;
  try {
    const light = (await getEntities(cfg)).find((e) => e.entity_id === entity);
    const rgb = light?.attributes.rgb_color;
    if (light?.state === "on" && Array.isArray(rgb) && rgb.length >= 3) {
      const [r, g, b] = rgb as [number, number, number];
      return `rgb(${r},${g},${b})`;
    }
  } catch {
    // HA injoignable : rouge par défaut
  }
  return SHUSHU_RED;
}

async function pollBattery(): Promise<void> {
  try {
    const bat = await invoke<{ level: number; charging: boolean }>("battery_status");
    sword.setEnv({ charging: bat.charging });
    if (sword.currentElement === "shushu") {
      shushuTint = await shushuAccent();
    }
    // machine sans batterie (tour, Mac mini) : forme monstre = plein régime
    updateShushu(bat.level < 0 ? 100 : bat.level, bat.charging, shushuTint);
  } catch {
    // commande indisponible : le monstre reste tel quel
  }
}

window.setInterval(() => void pollBattery(), 20_000);
void pollBattery();

// ---- élément automatique : Wakfu lancé → forme feu ----

let gameWasRunning = false;

async function pollGame(): Promise<void> {
  try {
    const running = await invoke<boolean>("process_running", { name: "wakfu" });
    if (running && !gameWasRunning) {
      window.setTimeout(() => say(replies.gameDetected(), "angry"), 1000);
    }
    gameWasRunning = running;
    sword.setEnv({ game: running });
  } catch {
    // commande indisponible : on reste sur la forme courante
  }
}

window.setInterval(() => void pollGame(), 30_000);
void pollGame();

// ---- démarrage ----

sword.setEnv({ muted: isMuted(), mini: localStorage.getItem(MINI_PREF) === "1" });
if (localStorage.getItem(MINI_PREF) === "1") void setMini(true);
restoreTimers();
moodlight.onElement(sword.currentElement); // couleur d'ambiance initiale

sword.set("wake");
if (localStorage.getItem(ONBOARD_KEY) !== "1") {
  window.setTimeout(() => void runOnboarding(), 1100);
} else {
  window.setTimeout(() => say(replies.greeting(), "angry"), 900);
}

// mise à jour automatique (silencieuse s'il n'y a rien) — desktop
// uniquement : sur Android, le vérificateur maison s'en charge
if (!IS_ANDROID) {
  window.setTimeout(() => {
    void checkForUpdates(
      (version) => say(replies.updateFound(version)),
      () => say(replies.updateRestart(), "angry"),
    );
  }, 10_000);
}

// vérification manuelle depuis les paramètres, avec retour explicite
$("btn-update-check").addEventListener("click", async () => {
  settingsStatus.textContent = "Je regarde si une version plus fraîche de moi existe…";
  const current = await getVersion().catch(() => "?");
  if (IS_ANDROID) {
    const outcome = await androidUpdateCheck();
    settingsStatus.textContent =
      outcome === "found"
        ? "Nouvelle version trouvée : le téléchargement s'ouvre. Installe, mortel."
        : outcome === "none"
          ? `Rien de neuf. Je suis déjà en ${current}, au sommet de ma forme.`
          : "Impossible de vérifier — t'es hors ligne ou GitHub boude.";
    return;
  }
  const outcome = await checkForUpdates(
    (version) => say(replies.updateFound(version)),
    () => say(replies.updateRestart(), "angry"),
  );
  settingsStatus.textContent =
    outcome === "installing"
      ? "Mise à jour trouvée : j'installe et je redémarre. Ne bouge pas."
      : outcome === "none"
        ? `Rien de neuf. Je suis déjà en ${current}, au sommet de ma forme.`
        : "Impossible de vérifier — hors ligne, ou build de développement.";
});
