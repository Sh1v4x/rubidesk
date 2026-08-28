/**
 * Le Fendoir — machine à états du personnage, portée depuis le design canvas
 * « Rubilax Trois Formes.dc.html ».
 *
 * Deux dimensions orthogonales :
 * - l'HUMEUR (8 états : repos, écoute, réflexion, confirmé, erreur, sommeil,
 *   réveil, colère) qui pilote paupières/pupille/iris/halo/braises/reflet ;
 * - l'ÉLÉMENT (normal, air, feu) : trois formes de l'épée, changées par une
 *   transformation « surcharge → explosion → retombée » (~900 ms).
 *
 * L'élément se résout automatiquement : feu si Wakfu tourne ou colère récente,
 * air si discret (muet / mode mini) ou endormi, normal sinon.
 */

import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { mountShushu, SHUSHU_RED } from "./shushu";

export type SwordState =
  | "idle"
  | "listen"
  | "think"
  | "success"
  | "error"
  | "sleep"
  | "wake"
  | "angry";

export type SwordElement = "normal" | "air" | "fire" | "shushu";

/** Les trois lames « classiques » (le monstre Shushu a sa propre anatomie). */
type BladeElement = "normal" | "air" | "fire";
const BLADES: BladeElement[] = ["normal", "air", "fire"];

interface StateDef {
  anim: string;
  open: number;
  slant: number;
  pupil: number;
  irisF: string;
  glow: number;
  pulse: boolean;
  fx: number;
  scan?: boolean;
}

const STATES: Record<SwordState, StateDef> = {
  idle: {
    anim: "breathe 5.2s ease-in-out infinite",
    open: 0.86, slant: 0, pupil: 1,
    irisF: "saturate(1) brightness(1)", glow: 0.34, pulse: false, fx: 0.25,
  },
  listen: {
    anim: "hover_alert 2.1s ease-in-out infinite",
    open: 1, slant: 0, pupil: 1.5,
    irisF: "saturate(1.25) brightness(1.3)", glow: 0.95, pulse: true, fx: 1,
  },
  think: {
    anim: "ponder 2.6s ease-in-out infinite",
    open: 0.58, slant: -6, pupil: 0.85,
    irisF: "saturate(1.05) brightness(1.06)", glow: 0.5, pulse: false, fx: 0.4, scan: true,
  },
  success: {
    anim: "triumph 1.1s cubic-bezier(.2,.9,.2,1) forwards",
    open: 0.4, slant: 10, pupil: 0.7,
    irisF: "saturate(1.35) brightness(1.45)", glow: 1, pulse: false, fx: 0.85,
  },
  error: {
    anim: "recoil .7s ease-out forwards",
    open: 0.48, slant: -14, pupil: 1.15,
    irisF: "saturate(.4) brightness(.82)", glow: 0.22, pulse: false, fx: 0,
  },
  sleep: {
    anim: "sag 7s ease-in-out infinite",
    open: 0.05, slant: 5, pupil: 0.55,
    irisF: "saturate(.3) brightness(.45)", glow: 0.05, pulse: false, fx: 0,
  },
  wake: {
    anim: "jolt .95s cubic-bezier(.2,.9,.2,1) forwards",
    open: 1, slant: 0, pupil: 0.38,
    irisF: "saturate(1.45) brightness(1.4)", glow: 0.9, pulse: true, fx: 1,
  },
  angry: {
    anim: "tremble .32s ease-in-out infinite",
    open: 0.66, slant: -18, pupil: 0.5,
    irisF: "saturate(1.6) brightness(1.22) hue-rotate(-8deg)", glow: 1, pulse: true, fx: 1,
  },
};

interface ElementDef {
  suffix: "n" | "a" | "f" | "v";
  color: string;
  /** centre de l'œil en coordonnées viewBox globales (260×880) */
  eyeY: number;
  eyeCy: number; // cy local (pour transform-origin des éléments du groupe)
  eyeR: number;
  shadow: number;
  maneOrigin: string;
  maneBase: number;
  maneAmp: number;
}

const ELEMENTS: Record<SwordElement, ElementDef> = {
  normal: {
    suffix: "n", color: "#e2703a", eyeY: 562, eyeCy: 322, eyeR: 45, shadow: 52,
    maneOrigin: "110px 118px", maneBase: 0.94, maneAmp: 0.09,
  },
  air: {
    suffix: "a", color: "#a8e05a", eyeY: 336, eyeCy: 196, eyeR: 34, shadow: 58,
    maneOrigin: "110px 76px", maneBase: 0.94, maneAmp: 0.1,
  },
  fire: {
    suffix: "f", color: "#ff6a12", eyeY: 272, eyeCy: 212, eyeR: 33, shadow: 66,
    maneOrigin: "110px 90px", maneBase: 0.92, maneAmp: 0.12,
  },
  // le monstre : l'œil bouge avec la taille, on vise la tête au stade moyen
  shushu: {
    suffix: "v", color: SHUSHU_RED, eyeY: 600, eyeCy: 0, eyeR: 38, shadow: 78,
    maneOrigin: "0px 0px", maneBase: 1, maneAmp: 0,
  },
};

const EASE = "transform .55s cubic-bezier(.34,.02,.24,1)";
const SLEEP_AFTER_MS = 3 * 60_000;
const ANGER_ELEMENT_MS = 2 * 60_000;

/** Contexte extérieur pour la résolution automatique de l'élément. */
export interface SwordEnv {
  game: boolean;
  muted: boolean;
  mini: boolean;
  /** appareil branché sur le secteur → Shushu sort de l'épée */
  charging: boolean;
}

interface FormParts {
  form: SVGGElement;
  mane: SVGGElement;
  lidTop: SVGPathElement;
  lidBot: SVGPathElement;
  pupil: SVGEllipseElement;
  iris: SVGGElement;
  glow: SVGCircleElement;
  pulse: SVGCircleElement;
}

export class Sword {
  private current: SwordState = "idle";
  private element: SwordElement = "normal";
  private morphing = false;

  private parts: Record<BladeElement, FormParts>;
  private forms: Record<SwordElement, SVGGElement>;
  private sheens: SVGRectElement[];
  private embersN: SVGGElement;
  private embersF: SVGGElement;
  private wind: SVGGElement;
  private lava: SVGGElement;
  private shadow: SVGEllipseElement;
  private burst: SVGGElement;
  private shock: SVGEllipseElement;
  private pokeZone: HTMLElement | null;

  private env: SwordEnv = { game: false, muted: false, mini: false, charging: false };
  private angerUntil = 0;
  /** poke de trop : le shushu sort de force, quelle que soit la préférence */
  private rageUntil = 0;
  /** Préférence utilisateur : forme imposée, ou "auto" (défaut). */
  private preference: SwordElement | "auto" = "auto";
  /** En mode auto, errance : de temps en temps il change de forme sans raison. */
  private wanderElement: SwordElement | null = null;
  private nextWanderAt = Date.now() + Sword.wanderDelay();

  private sleepTimer: number | undefined;
  private wakeChain: number | undefined;

  // suivi du regard
  private tx = 0;
  private ty = 0;
  private gx = 0;
  private gy = 0;

  constructor(private svg: SVGSVGElement) {
    const q = <T>(sel: string): T => svg.querySelector(sel) as T;
    const grab = (el: BladeElement): FormParts => {
      const s = ELEMENTS[el].suffix;
      return {
        form: q(`#form-${el === "fire" ? "fire" : el}`),
        mane: q(`#mane-${s}`),
        lidTop: q(`#lid-top-${s}`),
        lidBot: q(`#lid-bot-${s}`),
        pupil: q(`#pupil-${s}`),
        iris: q(`#iris-${s}`),
        glow: q(`#glow-${s}`),
        pulse: q(`#pulse-${s}`),
      };
    };
    this.parts = { normal: grab("normal"), air: grab("air"), fire: grab("fire") };
    this.forms = {
      normal: this.parts.normal.form,
      air: this.parts.air.form,
      fire: this.parts.fire.form,
      shushu: mountShushu(svg),
    };
    this.sheens = Array.from(svg.querySelectorAll(".sheen"));
    this.embersN = q("#embers-n");
    this.embersF = q("#embers-f");
    this.wind = q("#wind");
    this.lava = q("#lava");
    this.shadow = q("#shadow");
    this.burst = q("#burst");
    this.shock = q("#shock");
    this.pokeZone = document.getElementById("poke-zone");

    window.addEventListener("mousemove", (e) => this.updateGaze(e.clientX, e.clientY));
    this.startGlobalGaze();

    let savedPref = localStorage.getItem("rubilax.element");
    if (savedPref === "volthrak") savedPref = "shushu"; // ancien nom de code
    if (
      savedPref === "normal" ||
      savedPref === "air" ||
      savedPref === "fire" ||
      savedPref === "shushu"
    ) {
      this.preference = savedPref;
      this.element = savedPref;
    }

    this.showElement(this.element, true);
    this.apply(STATES.idle);
    this.scheduleBlink();
    this.armSleepTimer();
    window.setInterval(() => this.refreshElement(), 5_000);
    requestAnimationFrame((t) => this.tick(t));
  }

  get state(): SwordState {
    return this.current;
  }

  get currentElement(): SwordElement {
    return this.element;
  }

  /** Pousse le contexte extérieur (jeu lancé, muet, mini) et réévalue la forme. */
  setEnv(env: Partial<SwordEnv>): void {
    Object.assign(this.env, env);
    this.refreshElement();
  }

  get elementPreference(): SwordElement | "auto" {
    return this.preference;
  }

  /** Impose une forme (ou "auto" pour rendre la main à la logique automatique). */
  setPreference(pref: SwordElement | "auto"): void {
    this.preference = pref;
    localStorage.setItem("rubilax.element", pref);
    if (pref === "auto") this.nextWanderAt = Date.now() + Sword.wanderDelay();
    this.refreshElement();
  }

  private static wanderDelay(): number {
    return (10 + Math.random() * 15) * 60_000; // 10 à 25 minutes
  }

  /** Change d'état. S'il dormait, réveil brutal d'abord. */
  set(state: SwordState): void {
    window.clearTimeout(this.wakeChain);
    if (state === "angry" || state === "wake") {
      this.angerUntil = Date.now() + ANGER_ELEMENT_MS;
    }
    if (this.current === "sleep" && state !== "sleep" && state !== "wake") {
      this.transition("wake");
      this.wakeChain = window.setTimeout(() => this.transition(state), 950);
    } else {
      this.transition(state);
    }
    this.armSleepTimer();
    this.refreshElement();
  }

  /** État bref, puis retour au repos. */
  flash(state: SwordState, ms = 1600): void {
    this.set(state);
    window.clearTimeout(this.wakeChain);
    this.wakeChain = window.setTimeout(() => this.set("idle"), ms);
  }

  /** Poke de trop : le shushu jaillit de l'épée pour un temps, fou de rage. */
  rage(ms = 20_000): void {
    window.clearTimeout(this.wakeChain);
    this.rageUntil = Date.now() + ms;
    this.angerUntil = Date.now() + ANGER_ELEMENT_MS;
    this.transition("angry");
    this.wakeChain = window.setTimeout(() => this.set("idle"), Math.min(ms, 5000));
    this.armSleepTimer();
    this.refreshElement();
    // retour à la forme d'avant une fois calmé
    window.setTimeout(() => this.refreshElement(), ms + 100);
  }

  /** Clic sur l'œil : réveil brutal puis colère, comme dans le design. */
  poke(): void {
    window.clearTimeout(this.wakeChain);
    this.angerUntil = Date.now() + ANGER_ELEMENT_MS;
    this.transition("wake");
    this.wakeChain = window.setTimeout(() => {
      this.transition("angry");
      this.wakeChain = window.setTimeout(() => this.set("idle"), 2400);
    }, 1000);
    this.armSleepTimer();
    this.refreshElement();
  }

  // -------------------------------------------------------------------------
  // Élément : résolution automatique + transformation
  // -------------------------------------------------------------------------

  /**
   * Préférence utilisateur d'abord ; sinon : feu si Wakfu tourne ou colère
   * récente, air si discret ou endormi, et à défaut la forme d'errance —
   * de temps en temps, il se transforme juste parce que ça lui chante.
   */
  private desiredElement(): SwordElement {
    if (Date.now() < this.rageUntil) return "shushu"; // la rage passe avant TOUT
    if (this.preference !== "auto") return this.preference;
    if (this.env.charging) return "shushu"; // branché : le monstre sort
    if (this.env.game) return "fire";
    if (this.env.muted || this.env.mini || this.current === "sleep") return "air";
    if (Date.now() < this.angerUntil) return "fire";
    return this.wanderElement ?? "normal";
  }

  refreshElement(): void {
    if (this.preference === "auto" && Date.now() >= this.nextWanderAt) {
      const pool: SwordElement[] = ["normal", "normal", "air", "fire"]; // normal favorisé
      this.wanderElement = pool[Math.floor(Math.random() * pool.length)];
      this.nextWanderAt = Date.now() + Sword.wanderDelay();
    }
    const want = this.desiredElement();
    if (want !== this.element && !this.morphing) this.morph(want);
  }

  /** Surcharge de la forme actuelle, explosion, retombée de la nouvelle. */
  private morph(next: SwordElement): void {
    const prev = this.element;
    this.morphing = true;
    this.element = next;

    const prevForm = this.forms[prev];
    const nextForm = this.forms[next];
    const def = ELEMENTS[next];

    // phase 1 — dislocation de l'ancienne forme
    prevForm.style.transformOrigin = "130px 840px";
    prevForm.style.transition = "all .3s cubic-bezier(.4,0,.9,.3)";
    prevForm.style.opacity = "0";
    prevForm.style.transform = "scale(1.32) translateY(-20px)";
    prevForm.style.filter = "brightness(4.5) blur(8px)";

    // nouvelle forme pré-positionnée, invisible, compressée
    nextForm.style.transition = "none";
    nextForm.style.transformOrigin = "130px 840px";
    nextForm.style.opacity = "0";
    nextForm.style.visibility = "visible";
    nextForm.style.transform = "scale(.6) translateY(30px)";
    nextForm.style.filter = "blur(10px) brightness(2.6)";

    // explosion au niveau de l'œil de la nouvelle forme
    this.fireBurst(def);

    // phase 2 — la nouvelle forme retombe avec rebond ; l'interface suit
    window.setTimeout(() => {
      nextForm.style.transition = "all .5s cubic-bezier(.18,1.28,.4,1)";
      nextForm.style.opacity = "1";
      nextForm.style.transform = "scale(1.05)";
      nextForm.style.filter = "blur(0px) brightness(1.55)";
      this.applyBodyTheme(next);
    }, 300);

    // phase 3 — stabilisation
    window.setTimeout(() => {
      nextForm.style.transition = "all .42s cubic-bezier(.3,.9,.3,1)";
      nextForm.style.transform = "scale(1)";
      nextForm.style.filter = "none";
      prevForm.style.visibility = "hidden";
      this.shadow.setAttribute("rx", String(def.shadow));
      this.movePokeZone(def);
      this.morphing = false;
      this.apply(STATES[this.current]);
    }, 880);
  }

  private fireBurst(def: ElementDef): void {
    this.burst.style.transform = `translate(130px, ${def.eyeY}px)`;
    this.burst.style.pointerEvents = "none";
    this.burst.style.opacity = "1";
    const color = def.color;
    const set = (sel: string, anim: string, attr: "fill" | "stroke" | null): void => {
      for (const el of Array.from(this.burst.querySelectorAll<SVGElement>(sel))) {
        if (attr) el.setAttribute(attr, color);
        el.style.transformOrigin = "0px 0px";
        el.style.animation = "none";
        void el.getBoundingClientRect(); // relance l'animation
        el.style.animation = anim;
      }
    };
    set("#burst-flash", "burst_flash .85s cubic-bezier(.15,.75,.3,1) 0s forwards", "fill");
    set("#burst-ring1", "burst_ring .85s cubic-bezier(.15,.75,.3,1) .16s forwards", "stroke");
    set("#burst-ring2", "burst_ring2 .85s cubic-bezier(.15,.75,.3,1) .22s forwards", null);
    set("#burst-shards", "shard_out .85s cubic-bezier(.15,.75,.3,1) .2s forwards", null);
    for (const shard of Array.from(this.burst.querySelectorAll<SVGElement>(".shard"))) {
      shard.setAttribute("fill", color);
    }
    // onde de choc au sol
    this.shock.setAttribute("stroke", color);
    this.shock.style.transformOrigin = "130px 846px";
    this.shock.style.animation = "none";
    void this.shock.getBoundingClientRect();
    this.shock.style.animation = "shock .8s ease-out .34s forwards";
    window.setTimeout(() => {
      this.burst.style.opacity = "0";
    }, 1300);
  }

  private showElement(el: SwordElement, instant: boolean): void {
    for (const key of Object.keys(this.forms) as SwordElement[]) {
      const form = this.forms[key];
      form.style.transformOrigin = "130px 840px";
      if (key === el) {
        form.style.opacity = "1";
        form.style.visibility = "visible";
        form.style.transform = "scale(1)";
      } else {
        form.style.opacity = "0";
        form.style.visibility = "hidden";
      }
      if (instant) form.style.transition = "none";
    }
    const def = ELEMENTS[el];
    this.shadow.setAttribute("rx", String(def.shadow));
    this.movePokeZone(def);
    this.applyBodyTheme(el);
    this.burst.style.opacity = "0";
  }

  /** Prévenu à chaque forme appliquée (auto ou manuelle) — humeur → lumière. */
  onElementChange: ((el: SwordElement) => void) | null = null;

  /** Accent de l'interface (barre, bulle, menus) assorti à la forme. */
  private applyBodyTheme(el: SwordElement): void {
    document.body.classList.toggle("el-air", el === "air");
    document.body.classList.toggle("el-fire", el === "fire");
    document.body.classList.toggle("el-shushu", el === "shushu");
    this.onElementChange?.(el);
  }

  private movePokeZone(def: ElementDef): void {
    if (!this.pokeZone) return;
    this.pokeZone.style.top = `${((def.eyeY / 880) * 100).toFixed(1)}%`;
    const d = Math.round((def.eyeR * 2 * 620) / 880) + 14;
    this.pokeZone.style.width = `${d}px`;
    this.pokeZone.style.height = `${d}px`;
  }

  // -------------------------------------------------------------------------
  // Humeurs
  // -------------------------------------------------------------------------

  private transition(state: SwordState): void {
    this.current = state;
    this.apply(STATES[state]);
    this.refreshElement();
  }

  private armSleepTimer(): void {
    window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      if (this.current === "idle") this.transition("sleep");
    }, SLEEP_AFTER_MS);
  }

  private applyLids(el: BladeElement, s: StateDef, open: number): void {
    const def = ELEMENTS[el];
    const p = this.parts[el];
    const lid = def.eyeR * 1.7;
    const px = 1 - open;
    const origin = `110px ${def.eyeCy}px`;
    p.lidTop.style.transformOrigin = origin;
    p.lidTop.style.transition = EASE;
    p.lidTop.style.transform = `translateY(${(-lid + px * (lid + def.eyeR * 0.34)).toFixed(1)}px) rotate(${s.slant}deg)`;
    p.lidBot.style.transformOrigin = origin;
    p.lidBot.style.transition = EASE;
    p.lidBot.style.transform = `translateY(${(lid - px * lid * 0.52).toFixed(1)}px) rotate(${(s.slant * 0.28).toFixed(1)}deg)`;
  }

  private apply(s: StateDef): void {
    this.svg.style.animation = s.anim;
    this.svg.style.transformOrigin = "50% 96%";
    this.svg.style.willChange = "transform";

    for (const el of BLADES) {
      const def = ELEMENTS[el];
      const p = this.parts[el];
      const origin = `110px ${def.eyeCy}px`;

      p.mane.style.transformOrigin = def.maneOrigin;
      p.mane.style.transition = EASE;
      p.mane.style.transform = `scaleY(${(def.maneBase + s.open * def.maneAmp).toFixed(3)})`;

      this.applyLids(el, s, s.open);

      p.pupil.style.transformOrigin = origin;
      p.pupil.style.transition = EASE;
      p.pupil.style.transform = `scale(${s.pupil})`;

      p.iris.style.filter = s.irisF;
      p.iris.style.transition = "filter .5s ease";
      p.iris.style.transformOrigin = origin;
      p.iris.style.animation = s.scan ? "scan 2.6s ease-in-out infinite" : "";

      p.glow.style.opacity = String(s.glow);
      p.glow.style.transition = "opacity .6s ease";
      p.glow.style.transformOrigin = origin;
      p.glow.style.animation = s.glow > 0.8 ? "flicker 1.7s ease-in-out infinite" : "";

      if (s.pulse) {
        p.pulse.style.animation = "ring_pulse 1.5s ease-in-out infinite";
        p.pulse.style.transformOrigin = origin;
        p.pulse.style.opacity = "0.5";
      } else {
        p.pulse.style.animation = "";
        p.pulse.style.opacity = "0";
        p.pulse.style.transition = "opacity .4s ease";
      }
    }

    // effets propres à chaque forme
    this.embersN.style.opacity = String(s.fx);
    this.embersN.style.transition = "opacity .6s ease";
    this.embersF.style.opacity = String(Math.min(1, s.fx + 0.35));
    this.embersF.style.transition = "opacity .6s ease";
    this.wind.style.opacity = String(Math.min(1, s.fx + 0.3));
    this.wind.style.transition = "opacity .6s ease";
    this.lava.style.animation = `lava ${s.glow > 0.6 ? 1.6 : 3.4}s ease-in-out infinite`;
    this.lava.style.filter = `saturate(${(0.6 + s.glow * 0.8).toFixed(2)}) brightness(${(0.7 + s.glow * 0.6).toFixed(2)})`;
    this.lava.style.transition = "filter .6s ease";
    for (const sheen of this.sheens) {
      sheen.style.animation = `sheen ${s.glow > 0.6 ? 3.4 : 7.5}s linear infinite`;
      sheen.style.opacity = s.glow > 0.2 ? "0.5" : "0.12";
    }
  }

  private scheduleBlink(): void {
    window.setTimeout(() => {
      const s = STATES[this.current];
      const el = this.element;
      // Shushu cligne tout seul (animation CSS), pas de paupières d'épée
      if (el !== "shushu" && s.open > 0.5 && !this.morphing) {
        this.applyLids(el, s, 0.03);
        window.setTimeout(() => {
          if (this.element !== "shushu") {
            this.applyLids(el, STATES[this.current], STATES[this.current].open);
          }
        }, 140);
      }
      this.scheduleBlink();
    }, 2800 + Math.random() * 3800);
  }

  // -------------------------------------------------------------------------
  // Regard
  // -------------------------------------------------------------------------

  private updateGaze(clientX: number, clientY: number): void {
    const rect = this.svg.getBoundingClientRect();
    const def = ELEMENTS[this.element];
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * (def.eyeY / 880);
    const reach = window.innerWidth * 1.5;
    const dx = (clientX - cx) / reach;
    const dy = (clientY - cy) / reach;
    const len = Math.hypot(dx, dy) || 1;
    const clamp = Math.min(1, len);
    const amp = def.eyeR / 45; // amplitude proportionnelle à la taille de l'œil
    this.tx = (dx / len) * clamp * 7 * amp;
    this.ty = (dy / len) * clamp * 5 * amp;
  }

  private startGlobalGaze(): void {
    let win: ReturnType<typeof getCurrentWindow>;
    try {
      win = getCurrentWindow();
    } catch {
      return; // hors Tauri (tests navigateur) : suivi local seulement
    }
    let scale = 1;
    void win.scaleFactor().then((s) => (scale = s)).catch(() => {});
    window.setInterval(() => {
      void (async () => {
        try {
          const [cursor, origin] = await Promise.all([cursorPosition(), win.outerPosition()]);
          this.updateGaze((cursor.x - origin.x) / scale, (cursor.y - origin.y) / scale);
        } catch {
          // API indisponible : le suivi local par mousemove reste actif
        }
      })();
    }, 90);
  }

  private tick(_now: number): void {
    const still = this.current === "sleep" || this.current === "think";
    const targetX = still ? 0 : this.tx;
    const targetY = still ? 0 : this.ty;
    this.gx += (targetX - this.gx) * 0.08;
    this.gy += (targetY - this.gy) * 0.08;
    if (this.element !== "shushu") {
      const iris = this.parts[this.element].iris;
      if (!STATES[this.current].scan && !this.morphing) {
        iris.style.transform = `translate(${this.gx.toFixed(2)}px, ${this.gy.toFixed(2)}px)`;
      }
    }
    requestAnimationFrame((t) => this.tick(t));
  }
}
