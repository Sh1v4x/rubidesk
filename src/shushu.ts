/**
 * Rubilax hors de l'épée — sa vraie forme de shushu. (Nom de code interne :
 * shushu, hérité du design « Volthrak.dc.html » ; pour l'utilisateur,
 * c'est Rubilax, point.) Trapu et brun, bras plantés au sol, crête et
 * grande pointe dorsale crème, griffes, défenses, yeux incandescents,
 * rayures lumineuses sur les muscles (rouges — ou couleur de l'ampoule).
 *
 * Il évolue avec la batterie de l'appareil : cinq stades, de la petite
 * teigne au colosse. Chaque palier franchi fait pousser pointes et cornes
 * avec une onde de choc au sol.
 */

const L = (a: number, b: number, t: number): number => a + (b - a) * t;
const F = (n: number): number => Math.round(n * 10) / 10;

export const SHUSHU_RED = "#e02412";

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
let accent = SHUSHU_RED;
let lastStage = -1;
let flashTimer: number | undefined;
let renderedKey = "";

/** Crée le groupe #form-shushu (invisible) dans le SVG du personnage. */
export function mountShushu(svg: SVGSVGElement): SVGGElement {
  const defs = svg.querySelector("defs");
  if (defs && !svg.querySelector("#shbody")) {
    defs.insertAdjacentHTML(
      "beforeend",
      `<linearGradient id="shbody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4a3322"/><stop offset="0.55" stop-color="#33241a"/><stop offset="1" stop-color="#201510"/>
      </linearGradient>
      <linearGradient id="shhorn" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#96794f"/><stop offset="1" stop-color="#e9d6a6"/>
      </linearGradient>
      <filter id="shglow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="shsoft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>`,
    );
  }
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", "form-shushu");
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
export function updateShushu(newPct: number, newCharging: boolean, newAccent: string): void {
  pct = Math.max(0, Math.min(100, newPct));
  charging = newCharging;
  accent = newAccent || SHUSHU_RED;
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
  // Cendre → Fournaise : croissance sage et bien étagée. Colosse : hors
  // gabarit — près du double de la Fournaise — mais calibré pour remplir
  // la fenêtre sans en sortir : bras ≤ ±240 unités viewBox (bord visible
  // ≈ ±241 avec l'avatar 184×620), crête et pointe dorsale sous y=0
  // (le sol est ancré à y=846). Silhouette plus étroite que haute, sinon
  // la largeur des bras crève le cadre avant que la hauteur n'impressionne.
  const colosse = st === 4;
  const u = Math.min(st, 3) / 3;
  const H = colosse ? 600 : L(150, 320, u);
  const sw = colosse ? 155 : L(60, 118, u);
  const hw = colosse ? 105 : L(42, 82, u);
  const headR = colosse ? 54 : L(26, 46, t);
  const headY = -H * L(0.9, 0.84, t);

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
    const len = L(18, 68, t) * (colosse ? 1.6 : 1) * (0.5 + 0.6 * f);
    const w = L(3.5, 9, t) * (colosse ? 1.3 : 1) * (0.65 + 0.45 * (1 - f));
    const ang = -0.15 - 1.15 * f;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    spikes += `<path d="${tri(px, py, dx, dy, w)}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;
    spikes += `<path d="${tri(-px, py, -dx, dy, w)}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  // rayures incandescentes, symétriques sur pectoraux/épaules/bras comme
  // les marques rouges du shushu (couleur d'accent : rouge, ou l'ampoule)
  const rnd = prng(31);
  const nCr = [2, 3, 3, 4, 5][st];
  let cracks = "";
  for (let i = 0; i < nCr; i++) {
    const f = nCr === 1 ? 0.5 : i / (nCr - 1);
    const x0 = sw * (0.34 + 0.55 * f);
    const y0 = -H * (0.52 + 0.32 * (1 - f) + rnd() * 0.08);
    const seg = 3 + Math.floor(rnd() * 2);
    const jag: Array<[number, number]> = [[x0, y0]];
    let x = x0;
    let y = y0;
    for (let j = 0; j < seg; j++) {
      x -= sw * (0.08 + rnd() * 0.12);
      y += H * (0.05 + rnd() * 0.07) * (j % 2 === 0 ? 1 : -0.4);
      jag.push([x, y]);
    }
    const w = F(L(1.6, 4.2, t) * (0.7 + rnd() * 0.5));
    for (const dir of [1, -1]) {
      let d = `M ${F(dir * jag[0][0])} ${F(jag[0][1])}`;
      for (let j = 1; j < jag.length; j++) d += ` L ${F(dir * jag[j][0])} ${F(jag[j][1])}`;
      cracks += `<path d="${d}" stroke-width="${w}"/>`;
    }
  }
  // au-delà de la Forge, les bras aussi se marquent
  if (st >= 2) {
    for (const dir of [1, -1]) {
      const ax = sw * L(1.0, 1.12, t);
      cracks += `<path d="M ${F(dir * ax)} ${F(-H * 0.58)} L ${F(dir * (ax - sw * 0.08))} ${F(-H * 0.48)} L ${F(dir * (ax + sw * 0.04))} ${F(-H * 0.38)}" stroke-width="${F(L(1.6, 3.6, t))}"/>`;
    }
  }

  // grande pointe dorsale (derrière le corps, comme dans l'animé)
  const sailH = colosse ? 310 : L(24, 215, t);
  const sail =
    st >= 1
      ? `<path d="${tri(0, -H * 0.78, 10, -sailH, L(9, 30, t))}" fill="url(#shhorn)" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>`
      : "";

  // griffes crème : trois par poing, deux par pied
  const fistX = sw * L(0.96, 1.08, t) + armT * 0.1;
  const fistY = armEndY + fistR2 * 0.2;
  const clawLen = fistR2 * 0.62;
  let claws = "";
  for (const dir of [-1, 1]) {
    for (const off of [-0.45, 0, 0.45]) {
      claws += `<path d="${tri(dir * (fistX + off * fistR2 * 0.8), fistY + fistR2 * 0.55, dir * clawLen * 0.25, clawLen, clawLen * 0.22)}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
    for (const off of [1.18, 1.42]) {
      claws += `<path d="${tri(dir * hw * off, -6, dir * hw * 0.22, 4, L(2.5, 6, t))}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
  }

  // tête, cornes latérales, crête crème (5 pointes façon mohawk)
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
  const crestH = colosse ? 115 : L(14, 78, t);
  let crest = "";
  for (const [fx, fh] of [
    [-0.8, 0.42],
    [-0.4, 0.72],
    [0, 1],
    [0.4, 0.72],
    [0.8, 0.42],
  ] as Array<[number, number]>) {
    crest += `<path d="${tri(headR * fx * 0.95, crestTop + headR * 0.14 * Math.abs(fx), headR * fx * 0.4, -crestH * fh, L(3.5, 11, t) * (0.55 + 0.45 * fh))}" fill="url(#shhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>`;
  }

  // petites défenses qui dépassent de la mâchoire
  const tuskH = headR * L(0.4, 0.9, t);
  const tusks =
    `<path d="${tri(-headR * 0.38, headY + headR * 0.72, -2, -tuskH, L(2.5, 6, t))}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${tri(headR * 0.38, headY + headR * 0.72, 2, -tuskH, L(2.5, 6, t))}" fill="url(#shhorn)" stroke="#17100b" stroke-width="1.6" stroke-linejoin="round"/>`;

  // rictus mauvais sous les yeux
  const mouthY = headY + headR * 0.52;
  const mouth = `M ${F(-headR * 0.5)} ${F(mouthY + 3)} L ${F(-headR * 0.2)} ${F(mouthY)} L ${F(headR * 0.2)} ${F(mouthY)} L ${F(headR * 0.5)} ${F(mouthY + 3)}`;

  const eyeY = headY - headR * 0.12;
  const ew = L(6.5, 10, t);
  const eh = L(3.2, 5.2, t);
  const eyeL = `M ${F(-headR * 0.62 - ew)} ${F(eyeY + eh * 0.2)} L ${F(-headR * 0.62 + ew * 0.5)} ${F(eyeY - eh)} L ${F(-headR * 0.62 + ew)} ${F(eyeY + eh * 0.6)} Z`;
  const eyeR = `M ${F(headR * 0.62 + ew)} ${F(eyeY + eh * 0.2)} L ${F(headR * 0.62 - ew * 0.5)} ${F(eyeY - eh)} L ${F(headR * 0.62 - ew)} ${F(eyeY + eh * 0.6)} Z`;
  const lidL = `M ${F(-headR * 0.9)} ${F(eyeY)} Q ${F(-headR * 0.6)} ${F(eyeY + 5)} ${F(-headR * 0.28)} ${F(eyeY)}`;
  const lidR = `M ${F(headR * 0.9)} ${F(eyeY)} Q ${F(headR * 0.6)} ${F(eyeY + 5)} ${F(headR * 0.28)} ${F(eyeY)}`;

  const eyeColor = critical ? "#ff5238" : charging ? "#ffd27a" : "#ffeccb";
  const moodAnim = critical
    ? "sh-rage .16s linear infinite"
    : charging
      ? "sh-happy 1.5s cubic-bezier(.3,.7,.3,1) infinite"
      : dozing
        ? "sh-sleep 5.4s ease-in-out infinite"
        : st >= 3
          ? "sh-idle 3.2s ease-in-out infinite, sh-rumble .22s linear infinite"
          : "sh-idle 3.4s ease-in-out infinite";
  const lavaAnim = critical ? "sh-lavafast .45s ease-in-out infinite" : "sh-lava 2.6s ease-in-out infinite";
  const growAnim = flash ? "animation:sh-grow .7s cubic-bezier(.2,1.3,.4,1)" : "";

  const eyes = dozing
    ? `<g stroke="#5a4130" stroke-width="3" stroke-linecap="round" fill="none"><path d="${lidL}"/><path d="${lidR}"/></g>`
    : `<g filter="url(#shglow)" style="animation:sh-blink 5.2s ease-in-out infinite;transform-origin:0px ${F(eyeY)}px">
        <path d="${eyeL}" fill="${eyeColor}"/><path d="${eyeR}" fill="${eyeColor}"/>
      </g>`;

  inner.innerHTML = `
    <ellipse cx="0" cy="4" rx="${F(sw * 1.5)}" ry="15" fill="${accent}" opacity="0.15" filter="url(#shsoft)" style="animation:sh-ground 3.4s ease-in-out infinite"/>
    ${flash ? `<ellipse cx="0" cy="2" rx="150" ry="32" fill="none" stroke="${accent}" stroke-width="3" style="animation:sh-shock .7s ease-out forwards;transform-origin:0px 0px"/>` : ""}
    <g style="animation:${moodAnim};transform-origin:0px 0px">
      <g>
        <g fill="none" stroke="#17100b" stroke-linecap="round">
          <path d="${armPath(-1)}" stroke-width="${F(armT * 1.9 + 5)}"/>
          <path d="${armPath(1)}" stroke-width="${F(armT * 1.9 + 5)}"/>
        </g>
        <g fill="none" stroke="#3a2a1d" stroke-linecap="round">
          <path d="${armPath(-1)}" stroke-width="${F(armT * 1.9)}"/>
          <path d="${armPath(1)}" stroke-width="${F(armT * 1.9)}"/>
        </g>
        <g style="${growAnim};transform-origin:0px ${F(-H * 0.78)}px">${sail}</g>
        <path d="${foot(-1)}" fill="#2c1f16" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${foot(1)}" fill="#2c1f16" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${legs}" fill="url(#shbody)" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${legGap}" fill="#140d0a" opacity="0.95"/>
        <path d="${body}" fill="url(#shbody)" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${shoulderL}" fill="#3b2a1e" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${shoulderR}" fill="#3b2a1e" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${fistL}" fill="#43301f" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="${fistR}" fill="#43301f" stroke="#17100b" stroke-width="2.2" stroke-linejoin="round"/>
        ${claws}
        <path d="${plate}" fill="#251811" opacity="0.85"/>
        <g fill="none" stroke="${accent}" stroke-linecap="round" filter="url(#shglow)" style="animation:${lavaAnim}">${cracks}</g>
        <g style="${growAnim};transform-origin:0px 0px">${spikes}</g>
        <g style="${growAnim};transform-origin:0px ${F(headY)}px">${crest}</g>
        <path d="${hornL}" fill="url(#shhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>
        <path d="${hornR}" fill="url(#shhorn)" stroke="#17100b" stroke-width="2" stroke-linejoin="round"/>
        <path d="${head}" fill="#3a2a1e" stroke="#17100b" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${brow}" fill="#1c120c" opacity="0.95"/>
        <path d="${mouth}" fill="none" stroke="#17100b" stroke-width="2.6" stroke-linecap="round"/>
        ${tusks}
        ${eyes}
      </g>
    </g>`;
}

/** Le groupe SVG du monstre (après mountShushu). */
export function shushuForm(): SVGGElement | null {
  return root;
}
