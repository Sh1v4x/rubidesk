/**
 * Le Fendoir — machine à états du personnage, portée depuis le design canvas
 * « Rubilax pour application Tauri / Le Fendoir.dc.html ».
 * Huit états, chacun pilotant : animation de la lame, ouverture/inclinaison des
 * paupières, pupille, teinte de l'iris, halo, anneau pulsant, braises, reflet.
 */

import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

export type SwordState =
  | "idle"
  | "listen"
  | "think"
  | "success"
  | "error"
  | "sleep"
  | "wake"
  | "angry";

interface StateDef {
  anim: string;
  open: number; // 0 = paupières closes, 1 = grand ouvert
  slant: number; // inclinaison des paupières (degrés)
  pupil: number; // échelle de la pupille
  irisF: string; // filtre CSS sur l'iris
  glow: number; // opacité du halo
  pulse: boolean; // anneau pulsant
  ember: number; // opacité des braises
  scan?: boolean; // pupille qui balaye (réflexion)
}

const STATES: Record<SwordState, StateDef> = {
  idle: {
    anim: "breathe 5.2s ease-in-out infinite",
    open: 0.86, slant: 0, pupil: 1,
    irisF: "saturate(1) brightness(1)", glow: 0.34, pulse: false, ember: 0.25,
  },
  listen: {
    anim: "hover_alert 2.1s ease-in-out infinite",
    open: 1, slant: 0, pupil: 1.5,
    irisF: "saturate(1.25) brightness(1.3)", glow: 0.95, pulse: true, ember: 1,
  },
  think: {
    anim: "ponder 2.6s ease-in-out infinite",
    open: 0.58, slant: -6, pupil: 0.85,
    irisF: "saturate(1.05) brightness(1.06)", glow: 0.5, pulse: false, ember: 0.4, scan: true,
  },
  success: {
    anim: "triumph 1.1s cubic-bezier(.2,.9,.2,1) forwards",
    open: 0.4, slant: 10, pupil: 0.7,
    irisF: "saturate(1.35) brightness(1.45)", glow: 1, pulse: false, ember: 0.85,
  },
  error: {
    anim: "recoil .7s ease-out forwards",
    open: 0.48, slant: -14, pupil: 1.15,
    irisF: "saturate(.4) brightness(.82)", glow: 0.22, pulse: false, ember: 0,
  },
  sleep: {
    anim: "sag 7s ease-in-out infinite",
    open: 0.05, slant: 5, pupil: 0.55,
    irisF: "saturate(.3) brightness(.45)", glow: 0.05, pulse: false, ember: 0,
  },
  wake: {
    anim: "jolt .95s cubic-bezier(.2,.9,.2,1) forwards",
    open: 1, slant: 0, pupil: 0.38,
    irisF: "saturate(1.45) brightness(1.4)", glow: 0.9, pulse: true, ember: 1,
  },
  angry: {
    anim: "tremble .32s ease-in-out infinite",
    open: 0.66, slant: -18, pupil: 0.5,
    irisF: "saturate(1.6) brightness(1.22) hue-rotate(-8deg)", glow: 1, pulse: true, ember: 1,
  },
};

const EASE = "transform .55s cubic-bezier(.34,.02,.24,1)";
const LID = 76;
const ORIGIN = "110px 322px";
const SLEEP_AFTER_MS = 3 * 60_000;

export class Sword {
  private current: SwordState = "idle";
  private mane: SVGGElement;
  private lidTops: SVGPathElement[];
  private lidBot: SVGPathElement;
  private pupil: SVGEllipseElement;
  private irisG: SVGGElement;
  private glow: SVGCircleElement;
  private pulseRing: SVGCircleElement;
  private embers: SVGGElement;
  private sheen: SVGRectElement;

  private sleepTimer: number | undefined;
  private wakeChain: number | undefined;

  // suivi du regard
  private tx = 0;
  private ty = 0;
  private gx = 0;
  private gy = 0;

  constructor(private svg: SVGSVGElement) {
    const q = <T>(sel: string): T => svg.querySelector(sel) as T;
    this.mane = q("#mane");
    this.lidTops = Array.from(svg.querySelectorAll(".lid-top"));
    this.lidBot = q(".lid-bot");
    this.pupil = q("#pupil");
    this.irisG = q("#iris-g");
    this.glow = q("#glow");
    this.pulseRing = q("#pulse-ring");
    this.embers = q("#embers");
    this.sheen = q("#sheen");

    // suivi local (instantané quand la souris est sur la fenêtre)
    window.addEventListener("mousemove", (e) => this.updateGaze(e.clientX, e.clientY));
    // suivi global (la souris n'importe où sur l'écran)
    this.startGlobalGaze();

    this.apply(STATES.idle);
    this.scheduleBlink();
    this.armSleepTimer();
    requestAnimationFrame((t) => this.tick(t));
  }

  get state(): SwordState {
    return this.current;
  }

  /**
   * Change d'état. S'il dormait, il passe d'abord par un réveil brutal
   * avant de rejoindre l'état demandé.
   */
  set(state: SwordState): void {
    window.clearTimeout(this.wakeChain);
    if (this.current === "sleep" && state !== "sleep" && state !== "wake") {
      this.transition("wake");
      this.wakeChain = window.setTimeout(() => this.transition(state), 950);
    } else {
      this.transition(state);
    }
    this.armSleepTimer();
  }

  /** État bref, puis retour au repos. */
  flash(state: SwordState, ms = 1600): void {
    this.set(state);
    window.clearTimeout(this.wakeChain);
    this.wakeChain = window.setTimeout(() => this.set("idle"), ms);
  }

  /** Clic sur l'œil : réveil brutal puis colère, comme dans le design. */
  poke(): void {
    window.clearTimeout(this.wakeChain);
    this.transition("wake");
    this.wakeChain = window.setTimeout(() => {
      this.transition("angry");
      this.wakeChain = window.setTimeout(() => this.set("idle"), 2400);
    }, 1000);
    this.armSleepTimer();
  }

  /** Oriente le regard vers un point (coordonnées client, même hors fenêtre). */
  private updateGaze(clientX: number, clientY: number): void {
    const rect = this.svg.getBoundingClientRect();
    // centre de l'œil (110,322 dans un viewBox 220×620)
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * (322 / 620);
    // amplitude max atteinte à ~1,5 largeur de fenêtre : au-delà, le regard sature
    const reach = window.innerWidth * 1.5;
    const dx = (clientX - cx) / reach;
    const dy = (clientY - cy) / reach;
    const len = Math.hypot(dx, dy) || 1;
    const clamp = Math.min(1, len);
    this.tx = (dx / len) * clamp * 7;
    this.ty = (dy / len) * clamp * 5;
  }

  /**
   * Interroge la position globale du curseur (~11 Hz) et la convertit en
   * coordonnées fenêtre — l'œil suit la souris partout sur l'écran.
   */
  private startGlobalGaze(): void {
    const win = getCurrentWindow();
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

  private transition(state: SwordState): void {
    this.current = state;
    this.apply(STATES[state]);
  }

  private armSleepTimer(): void {
    window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      if (this.current === "idle") this.transition("sleep");
    }, SLEEP_AFTER_MS);
  }

  private applyLids(s: StateDef, open: number): void {
    const px = 1 - open;
    const top = `translateY(${(-LID + px * (LID + 16)).toFixed(1)}px) rotate(${s.slant}deg)`;
    const bot = `translateY(${(LID - px * (LID * 0.52)).toFixed(1)}px) rotate(${(s.slant * 0.28).toFixed(1)}deg)`;
    for (const lid of this.lidTops) {
      lid.style.transformOrigin = ORIGIN;
      lid.style.transition = EASE;
      lid.style.transform = top;
    }
    this.lidBot.style.transformOrigin = ORIGIN;
    this.lidBot.style.transition = EASE;
    this.lidBot.style.transform = bot;
  }

  private apply(s: StateDef): void {
    this.svg.style.animation = s.anim;
    this.svg.style.transformOrigin = "50% 100%";
    this.svg.style.willChange = "transform";

    this.mane.style.transformOrigin = "110px 118px";
    this.mane.style.transition = EASE;
    this.mane.style.transform = `scaleY(${(0.94 + s.open * 0.09).toFixed(3)})`;

    this.applyLids(s, s.open);

    this.pupil.style.transformOrigin = ORIGIN;
    this.pupil.style.transition = EASE;
    this.pupil.style.transform = `scale(${s.pupil})`;

    this.irisG.style.filter = s.irisF;
    this.irisG.style.transition = "filter .5s ease";
    this.irisG.style.transformOrigin = ORIGIN;
    this.irisG.style.animation = s.scan ? "scan 2.6s ease-in-out infinite" : "";

    this.glow.style.opacity = String(s.glow);
    this.glow.style.transition = "opacity .6s ease";
    this.glow.style.transformOrigin = ORIGIN;
    this.glow.style.animation = s.glow > 0.8 ? "flicker 1.7s ease-in-out infinite" : "";

    if (s.pulse) {
      this.pulseRing.style.animation = "ring_pulse 1.5s ease-in-out infinite";
      this.pulseRing.style.transformOrigin = ORIGIN;
      this.pulseRing.style.opacity = "0.5";
    } else {
      this.pulseRing.style.animation = "";
      this.pulseRing.style.opacity = "0";
      this.pulseRing.style.transition = "opacity .4s ease";
    }

    this.embers.style.opacity = String(s.ember);
    this.embers.style.transition = "opacity .6s ease";

    this.sheen.style.animation = `sheen ${s.glow > 0.6 ? 3.4 : 7.5}s linear infinite`;
    this.sheen.style.opacity = s.glow > 0.2 ? "0.5" : "0.12";
  }

  private scheduleBlink(): void {
    window.setTimeout(() => {
      const s = STATES[this.current];
      if (s.open > 0.5) {
        this.applyLids(s, 0.03);
        window.setTimeout(() => this.applyLids(STATES[this.current], STATES[this.current].open), 140);
      }
      this.scheduleBlink();
    }, 2800 + Math.random() * 3800);
  }

  private tick(_now: number): void {
    const still = this.current === "sleep" || this.current === "think";
    const targetX = still ? 0 : this.tx;
    const targetY = still ? 0 : this.ty;
    this.gx += (targetX - this.gx) * 0.08;
    this.gy += (targetY - this.gy) * 0.08;
    if (!STATES[this.current].scan) {
      this.irisG.style.transform = `translate(${this.gx.toFixed(2)}px, ${this.gy.toFixed(2)}px)`;
    }
    requestAnimationFrame((t) => this.tick(t));
  }
}
