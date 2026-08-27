/**
 * Volthrak — la vraie forme de Rubilax, hors de l'épée. Monstre paramétrique
 * porté depuis le design « Volthrak.dc.html », rapproché du Rubilax de
 * l'animé : trapu et brun, pointes crème sur le dos et le crâne, petites
 * cornes, défenses, yeux pâles incandescents, marques lumineuses sur les
 * muscles (rouges par défaut — ou de la couleur de l'ampoule d'humeur).
 *
 * Il évolue avec la batterie de l'appareil : cinq stades, de la petite
 * teigne (Cendre) au colosse (Colosse). Chaque palier franchi fait pousser
 * pointes et cornes avec une onde de choc au sol.
 */

const L = (a: number, b: number, t: number): number => a + (b - a) * t;
const F = (n: number): number => Math.round(n * 10) / 10;

export const VOLTHRAK_RED = "#e02412";

export const STAGE_NAMES = ["Cendre", "Braise", "Forge", "Fournaise", "Colosse"] as const;

function prng(seed: number): () => number {
  let s = seed % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

type Pt = [number, number];

function smoothClosed(pts: Pt[]): string {
  const n = pts.length;
  let d = `M ${F((pts[0][0] + pts[n - 1][0]) / 2)} ${F((pts[0][1] + pts[n - 1][1]) / 2)}`;
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const nx = pts[(i + 1) % n];
    d += ` Q ${F(c[0])} ${F(c[1])} ${F((c[0] + nx[0]) / 2)} ${F((c[1] + nx[1]) / 2)}`;
  }
  return d + " Z";
}

function smoothOpen(pts: Pt[]): string {
  let d = `M ${F(pts[0][0])} ${F(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const nx = pts[i + 1];
    d += ` Q ${F(c[0])} ${F(c[1])} ${F((c[0] + nx[0]) / 2)} ${F((c[1] + nx[1]) / 2)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L ${F(l[0])} ${F(l[1])}`;
}

function tri(x: number, y: number, dx: number, dy: number, w: number): string {
  const nx = -dy;
  const ny = dx;
  const m = Math.hypot(nx, ny) || 1;
  return `M ${F(x + (nx / m) * w)} ${F(y + (ny / m) * w)} L ${F(x + dx)} ${F(y + dy)} L ${F(x - (nx / m) * w)} ${F(y - (ny / m) * w)} Z`;
}

/** Stade 0-4 selon le niveau de batterie. */
export function batteryStage(pct: number): number {
  return pct <= 15 ? 0 : pct <= 35 ? 1 : pct <= 60 ? 2 : pct <= 85 ? 3 : 4;
}

// ---------------------------------------------------------------------------
// État du monstre + rendu
// ---------------------------------------------------------------------------

let root: SVGGElement | null = null;
let inner: SVGGElement | null = null;
let pct = 72;
let charging = false;
let accent = VOLTHRAK_RED;
let lastStage = -1;
let flashTimer: number | undefined;
let renderedKey = "";

/** Crée le groupe #form-volthrak (invisible) dans le SVG du personnage. */
export function mountVolthrak(svg: SVGSVGElement): SVGGElement {
  const defs = svg.querySelector("defs");
  if (defs && !svg.querySelector("#vkbody")) {
    defs.insertAdjacentHTML(
      "beforeend",
      `<linearGradient id="vkbody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4a3322"/><stop offset="0.55" stop-color="#33241a"/><stop offset="1" stop-color="#201510"/>
      </linearGradient>
      <linearGradient id="vkhorn" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#96794f"/><stop offset="1" stop-color="#e9d6a6"/>
      </linearGradient>
      <filter id="vkglow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="vksoft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>`,
    );
  }
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", "form-volthrak");
  g.style.opacity = "0";
  g.style.visibility = "hidden";
  svg.insertBefore(g, svg.querySelector("#burst"));
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
  holder.setAttribute("transform", "translate(130 846)");
  g.appendChild(holder);
  root = g;
  inner = holder;
  lastStage = batteryStage(pct);
  renderedKey = ""; // remontage : forcer un premier rendu
  render(false);
  return g;
}

/** Pousse batterie / charge / couleur d'accent ; re-dessine si nécessaire. */
export function updateVolthrak(newPct: number, newCharging: boolean, newAccent: string): void {
  pct = Math.max(0, Math.min(100, newPct));
  charging = newCharging;
  accent = newAccent || VOLTHRAK_RED;
  const stage = batteryStage(pct);
  if (lastStage >= 0 && stage !== lastStage) {
    // palier franchi : pointes qui poussent + onde de choc
    lastStage = stage;
    render(true);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => render(false), 800);
    return;
  }
  lastStage = stage;
  render(false);
}

function render(flash: boolean): void {
  if (!inner) return;
  const st = batteryStage(pct);
  const critical = pct <= 10 && !charging;
  const dozing = !charging && !critical && pct <= 25;
  const key = [st, charging, critical, dozing, accent, flash].join("|");
  if (key === renderedKey) return;
  renderedKey = key;

  const t = st / 4;
  const H = L(176, 342, t);
  const sw = L(66, 190, t);
  const hw = L(46, 126, t);
  const headR = L(26, 46, t);
  const headY = -H * L(0.9, 0.84, t);
  const k = F(L(1.22, 1.0, t));

  const blob = (cx: number, cy: number, rx: number, ry: number): string =>
    `M ${F(cx - rx)} ${F(cy)} A ${F(rx)} ${F(ry)} 0 0 1 ${F(cx + rx)} ${F(cy)} A ${F(rx)} ${F(ry)} 0 0 1 ${F(cx - rx)} ${F(cy)} Z`;

  const foot = (dir: number): string =>
    smoothClosed([
      [dir * hw * 0.18, -L(14, 26, t)],
      [dir * hw * L(1.42, 1.5, t), -L(11, 22, t)],
      [dir * hw * L(1.48, 1.56, t), 2],
      [dir * hw * 0.12, 4],
    ]);

  const legs = smoothClosed([
    [-hw * 1.02, -8],
    [-hw * L(1.06, 1.16, t), -H * 0.2],
    [-hw * L(0.9, 0.98, t), -H * 0.38],
    [0, -H * 0.46],
    [hw * L(0.9, 0.98, t), -H * 0.38],
    [hw * L(1.06, 1.16, t), -H * 0.2],
    [hw * 1.02, -8],
    [0, 0],
  ]);
  const gapW = L(7, 20, t);
  const legGap = smoothClosed([
    [-gapW, -4],
    [-gapW * 0.6, -H * 0.14],
    [0, -H * L(0.26, 0.34, t)],
    [gapW * 0.6, -H * 0.14],
    [gapW, -4],
  ]);

  // torse voûté : taille étroite, trapèzes massifs, pas de cou
  const tw = L(0.5, 0.46, t);
  const body = smoothClosed([
    [-sw * tw, -H * 0.3],
    [-sw * L(0.78, 0.86, t), -H * 0.5],
    [-sw * 0.96, -H * 0.68],
    [-sw * L(0.82, 0.9, t), -H * 0.84],
    [-sw * L(0.34, 0.42, t), -H * 0.95],
    [0, -H],
    [sw * L(0.34, 0.42, t), -H * 0.95],
    [sw * L(0.82, 0.9, t), -H * 0.84],
    [sw * 0.96, -H * 0.68],
    [sw * L(0.78, 0.86, t), -H * 0.5],
    [sw * tw, -H * 0.3],
    [0, -H * 0.24],
  ]);
  const plate = smoothClosed([
    [-sw * 0.4, -H * 0.4],
    [-sw * 0.46, -H * 0.6],
    [0, -H * 0.68],
    [sw * 0.46, -H * 0.6],
    [sw * 0.4, -H * 0.4],
    [0, -H * 0.33],
  ]);

  const shR = sw * L(0.3, 0.38, t);
  const shoulderL = blob(-sw * 0.72, -H * 0.8, shR, shR * 0.86);
  const shoulderR = blob(sw * 0.72, -H * 0.8, shR, shR * 0.86);

  // bras plantés au sol façon gorille, comme le Rubilax de l'animé
  const armT = L(15, 44, t);
  const armEndY = -H * L(0.16, 0.05, t);
  const armPath = (dir: number): string =>
    smoothOpen([
      [dir * sw * 0.74, -H * 0.82],
      [dir * sw * L(1.0, 1.12, t), -H * 0.62],
      [dir * sw * L(1.02, 1.16, t), -H * 0.4],
      [dir * sw * L(0.96, 1.08, t), armEndY],
    ]);
  const fistR2 = armT * L(1.3, 1.45, t);
  const fistL = blob(-sw * L(0.96, 1.08, t) - armT * 0.1, armEndY + fistR2 * 0.2, fistR2, fistR2 * 0.92);
  const fistR = blob(sw * L(0.96, 1.08, t) + armT * 0.1, armEndY + fistR2 * 0.2, fistR2, fistR2 * 0.92);

  // pointes crème du dos et des épaules (comme le Rubilax de l'animé)
  const nSp = [2, 3, 4, 6, 8][st];
  let spikes = "";
  for (let i = 0; i < nSp; i++) {
    const f = nSp === 1 ? 0.85 : i / (nSp - 1);
    const px = sw * L(1.02, 0.72, f);
    const py = -H * (0.52 + 0.44 * f);
    const len = L(18, 68, t) * (0.5 + 0.6 * f);
    const w = L(3.5, 9, t) * (0.65 + 0.45 * (1 - f));
    const ang = -0.15 - 1.15 * f;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    spikes += `<path d="${tri(px, py, dx, dy, w)}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;
    spikes += `<path d="${tri(-px, py, -dx, dy, w)}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  // marques incandescentes (couleur d'accent : rouge, ou l'ampoule)
  const rnd = prng(31);
  const nCr = [3, 4, 6, 8, 10][st];
  let cracks = "";
  for (let i = 0; i < nCr; i++) {
    let x = (rnd() * 2 - 1) * sw * 0.78;
    let y = -H * (0.12 + rnd() * 0.76);
    let d = `M ${F(x)} ${F(y)}`;
    const seg = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < seg; j++) {
      x += (rnd() * 2 - 1) * sw * 0.24;
      y -= (rnd() - 0.35) * H * 0.1;
      d += ` L ${F(x)} ${F(y)}`;
    }
    cracks += `<path d="${d}" stroke-width="${F(L(1.2, 3.4, t) * (0.6 + rnd() * 0.7))}"/>`;
  }

  // tête, cornes latérales, crête crème (3 pointes façon mohawk)
  const head = smoothClosed([
    [-headR * 0.92, headY + headR * 0.5],
    [-headR, headY - headR * 0.2],
    [-headR * 0.55, headY - headR * 0.85],
    [headR * 0.55, headY - headR * 0.85],
    [headR, headY - headR * 0.2],
    [headR * 0.92, headY + headR * 0.5],
    [0, headY + headR * 0.86],
  ]);
  const brow = smoothClosed([
    [-headR * 0.9, headY - headR * 0.34],
    [0, headY - headR * 0.05],
    [headR * 0.9, headY - headR * 0.34],
    [0, headY - headR * 0.6],
  ]);
  const hl = L(10, 34, t);
  const hornL = tri(-headR * 0.88, headY - headR * 0.32, -hl * 0.85, -hl * 0.75, L(4, 9, t));
  const hornR = tri(headR * 0.88, headY - headR * 0.32, hl * 0.85, -hl * 0.75, L(4, 9, t));
  const crestTop = headY - headR * 0.62;
  const crestH = L(16, 130, t);
  let crest = "";
  for (const [fx, fh] of [
    [-0.5, 0.52],
    [0, 1],
    [0.5, 0.62],
  ] as Array<[number, number]>) {
    crest += `<path d="${tri(headR * fx * 0.9, crestTop, headR * fx * 0.5, -crestH * fh, L(4, 13, t) * (0.6 + 0.4 * fh))}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>`;
  }

  // petites défenses qui dépassent de la mâchoire
  const tuskH = headR * L(0.4, 0.9, t);
  const tusks =
    `<path d="${tri(-headR * 0.38, headY + headR * 0.72, -2, -tuskH, L(2.5, 6, t))}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${tri(headR * 0.38, headY + headR * 0.72, 2, -tuskH, L(2.5, 6, t))}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;

  const eyeY = headY - headR * 0.12;
  const ew = L(6.5, 10, t);
  const eh = L(3.2, 5.2, t);
  const eyeL = `M ${F(-headR * 0.62 - ew)} ${F(eyeY + eh * 0.2)} L ${F(-headR * 0.62 + ew * 0.5)} ${F(eyeY - eh)} L ${F(-headR * 0.62 + ew)} ${F(eyeY + eh * 0.6)} Z`;
  const eyeR = `M ${F(headR * 0.62 + ew)} ${F(eyeY + eh * 0.2)} L ${F(headR * 0.62 - ew * 0.5)} ${F(eyeY - eh)} L ${F(headR * 0.62 - ew)} ${F(eyeY + eh * 0.6)} Z`;
  const lidL = `M ${F(-headR * 0.9)} ${F(eyeY)} Q ${F(-headR * 0.6)} ${F(eyeY + 5)} ${F(-headR * 0.28)} ${F(eyeY)}`;
  const lidR = `M ${F(headR * 0.9)} ${F(eyeY)} Q ${F(headR * 0.6)} ${F(eyeY + 5)} ${F(headR * 0.28)} ${F(eyeY)}`;

  const eyeColor = critical ? "#ff5238" : charging ? "#ffd27a" : "#ffeccb";
  const moodAnim = critical
    ? "vk-rage .16s linear infinite"
    : charging
      ? "vk-happy 1.5s cubic-bezier(.3,.7,.3,1) infinite"
      : dozing
        ? "vk-sleep 5.4s ease-in-out infinite"
        : st >= 3
          ? "vk-idle 3.2s ease-in-out infinite, vk-rumble .22s linear infinite"
          : "vk-idle 3.4s ease-in-out infinite";
  const lavaAnim = critical ? "vk-lavafast .45s ease-in-out infinite" : "vk-lava 2.6s ease-in-out infinite";
  const growAnim = flash ? "animation:vk-grow .7s cubic-bezier(.2,1.3,.4,1)" : "";

  const eyes = dozing
    ? `<g stroke="#5a4130" stroke-width="3" stroke-linecap="round" fill="none"><path d="${lidL}"/><path d="${lidR}"/></g>`
    : `<g filter="url(#vkglow)" style="animation:vk-blink 5.2s ease-in-out infinite;transform-origin:0px ${F(eyeY)}px">
        <path d="${eyeL}" fill="${eyeColor}"/><path d="${eyeR}" fill="${eyeColor}"/>
      </g>`;

  inner.innerHTML = `
    <ellipse cx="0" cy="4" rx="${F(sw * 1.5 * k)}" ry="15" fill="${accent}" opacity="0.15" filter="url(#vksoft)" style="animation:vk-ground 3.4s ease-in-out infinite"/>
    ${flash ? `<ellipse cx="0" cy="2" rx="150" ry="32" fill="none" stroke="${accent}" stroke-width="3" style="animation:vk-shock .7s ease-out forwards;transform-origin:0px 0px"/>` : ""}
    <g style="animation:${moodAnim};transform-origin:0px 0px">
      <g transform="scale(${k})">
        <g fill="none" stroke="#17100b" stroke-linecap="round">
          <path d="${armPath(-1)}" stroke-width="${F(armT * 1.9 + 5)}"/>
          <path d="${armPath(1)}" stroke-width="${F(armT * 1.9 + 5)}"/>
        </g>
        <g fill="none" stroke="#3a2a1d" stroke-linecap="round">
          <path d="${armPath(-1)}" stroke-width="${F(armT * 1.9)}"/>
          <path d="${armPath(1)}" stroke-width="${F(armT * 1.9)}"/>
        </g>
        <path d="${foot(-1)}" fill="#2c1f16" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${foot(1)}" fill="#2c1f16" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${legs}" fill="url(#vkbody)" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${legGap}" fill="#140d0a" opacity="0.95"/>
        <path d="${body}" fill="url(#vkbody)" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${shoulderL}" fill="#3b2a1e" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${shoulderR}" fill="#3b2a1e" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${fistL}" fill="#43301f" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${fistR}" fill="#43301f" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${plate}" fill="#251811" opacity="0.85"/>
        <g fill="none" stroke="${accent}" stroke-linecap="round" filter="url(#vkglow)" style="animation:${lavaAnim}">${cracks}</g>
        <g style="${growAnim};transform-origin:0px 0px">${spikes}</g>
        <g style="${growAnim};transform-origin:0px ${F(headY)}px">${crest}</g>
        <path d="${hornL}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>
        <path d="${hornR}" fill="url(#vkhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>
        <path d="${head}" fill="#3a2a1e" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${brow}" fill="#1c120c" opacity="0.95"/>
        ${tusks}
        ${eyes}
      </g>
    </g>`;
}

/** Le groupe SVG du monstre (après mountVolthrak). */
export function volthrakForm(): SVGGElement | null {
  return root;
}
