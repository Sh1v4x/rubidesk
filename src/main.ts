import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
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
  formatDuration,
  type Action,
} from "./intent";
import * as ha from "./ha";
import type { HaEntity } from "./ha";

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
const timers: number[] = [];

function scheduleTimer(ms: number, label: string): void {
  const id = window.setTimeout(() => {
    const idx = timers.indexOf(id);
    if (idx >= 0) timers.splice(idx, 1);
    sword.set("wake");
    window.setTimeout(() => say(replies.timerFired(label), "angry"), 900);
  }, ms);
  timers.push(id);
  say(replies.timerSet(formatDuration(ms)), "success");
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

async function handleCommand(text: string): Promise<void> {
  sword.set("think");

  // minuteurs et rappels
  const timer = parseTimer(text);
  if (timer === "cancel") {
    const count = timers.length;
    for (const id of timers.splice(0)) window.clearTimeout(id);
    say(replies.timerCancelled(count), count > 0 ? "success" : "error");
    return;
  }
  if (timer) {
    scheduleTimer(timer.ms, timer.label);
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
    await handleOpen(open);
    return;
  }

  const intent = parseIntent(text);
  if (!intent) {
    say(replies.noIntent(), "error");
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
    void handleCommand(text);
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
      await handleCommand(text);
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
  if (listeningNow) {
    // deuxième clic = fin d'écoute immédiate
    await invoke("stt_stop");
    return;
  }
  void listenAndHandle();
});

// ---- mot d'éveil « Rubilax » ----

const WAKE_PREF = "rubilax.wake";
const wakeBtn = $("btn-wake");

async function setWakeMode(on: boolean): Promise<void> {
  if (on) {
    const ready = await invoke<boolean>("wake_model_ready");
    if (!ready) {
      bubble.textContent = "Je télécharge mes petites oreilles de veille (~32 Mo)…";
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

if (localStorage.getItem(WAKE_PREF) === "1") {
  void setWakeMode(true).catch(console.error);
}

// ---- settings ----

$("btn-settings").addEventListener("click", () => {
  const cfg = ha.loadConfig();
  if (cfg) {
    urlInput.value = cfg.url;
    tokenInput.value = cfg.token;
  }
  settingsStatus.textContent = "";
  settingsPanel.classList.toggle("hidden");
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
  await getCurrentWindow().setSize(new LogicalSize(340, on ? 580 : 720));
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
    case "mini":
      void setMini(!document.body.classList.contains("mini"));
      break;
    case "mute":
      setMuted(!isMuted());
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

// ---- démarrage ----

if (localStorage.getItem(MINI_PREF) === "1") void setMini(true);

sword.set("wake");
window.setTimeout(() => say(replies.greeting(), "angry"), 900);
