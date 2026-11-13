// Draws Zorion the pig. One source for every look, so the head, the full body, the chef
// (free) and star (Pro) looks, and the outlined versions for dark backgrounds always match.
//   node scripts/mascot.mjs            rewrites the mascot in packages/core/src/art.ts and the app icons
//   node scripts/mascot.mjs --preview  prints JSON of every look in every palette (for mockups)

export const PALETTES = {
  black: { skin: '#16171C', shade: '#23252E', back: '#2A2C34', accent: '#FFA6FC', deep: '#D45FD0', blush: '#FFA6FC', blushOp: 0.55, mouth: '#FFFFFF', eyes: 'shiny', starEdge: '#F5C242' },
  pink: { skin: '#FFB8E0', shade: '#FFCDEA', back: '#F59BCF', accent: '#F77CC2', deep: '#C94A93', blush: '#F2629F', blushOp: 0.45, mouth: '#7A2A55', eyes: 'dot', starEdge: '#B7860B' },
};
const RIM = '#F5F5F7';
const GOLD = '#F5C242';

const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(120 - +x).toFixed(1)} ${y}`);
const star = (cx, cy, r, inner = 0.45) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
};

// ---------- head, drawn in a 120-wide frame ----------
const HEAD = 'M60 19 C88 19 108 35 111 62 C114 90 92 106 60 106 C28 106 6 90 9 62 C12 35 32 19 60 19 Z';
const EAR_L = 'M17 47 C8 33 8 15 17 9 C26 4 41 15 47 26 C39 33 27 40 17 47 Z';
const EAR_L_IN = 'M20 37 C16 28 16 18 21 14 C27 12 34 19 38 25 C32 29 26 33 20 37 Z';
const EAR_R = mirror(EAR_L);
const EAR_R_IN = mirror(EAR_L_IN);

function eyes(p) {
  if (p.eyes === 'dot') {
    return [38, 82].map((x) => `<circle cx="${x}" cy="60" r="5.6" fill="#3A1E2C"></circle><circle cx="${x - 1.8}" cy="58" r="1.9" fill="#FFFFFF"></circle>`).join('');
  }
  return [38, 82].map((x) => `<ellipse cx="${x}" cy="59" rx="8.4" ry="9.4" fill="#FFFFFF"></ellipse><circle cx="${x + 0.6}" cy="61" r="6.6" fill="#0B0B0D"></circle><circle cx="${x - 2}" cy="58" r="2.5" fill="#FFFFFF"></circle><circle cx="${x + 2.8}" cy="64" r="1.1" fill="#FFFFFF"></circle>`).join('');
}
function snout(p) {
  return `<ellipse cx="60" cy="78" rx="19" ry="13.5" fill="${p.accent}"></ellipse><ellipse cx="54" cy="72.5" rx="7" ry="3" fill="#FFFFFF" opacity="0.35"></ellipse><ellipse cx="53" cy="79" rx="3.2" ry="4.8" fill="${p.deep}"></ellipse><ellipse cx="67" cy="79" rx="3.2" ry="4.8" fill="${p.deep}"></ellipse>`;
}
const cheeks = (p) => `<circle cx="24" cy="76" r="10" fill="${p.blush}" opacity="${p.blushOp}"></circle><circle cx="96" cy="76" r="10" fill="${p.blush}" opacity="${p.blushOp}"></circle>`;
const earsAndHead = (p) => `<path d="${EAR_L}" fill="${p.skin}"></path><path d="${EAR_R}" fill="${p.skin}"></path><path d="${EAR_L_IN}" fill="${p.accent}"></path><path d="${EAR_R_IN}" fill="${p.accent}"></path><path d="${HEAD}" fill="${p.skin}"></path>`;
const headRim = (w = 6) => `<g fill="${RIM}" stroke="${RIM}" stroke-width="${w}" stroke-linejoin="round"><path d="${EAR_L}"></path><path d="${EAR_R}"></path><path d="${HEAD}"></path></g>`;

const chefHat = (p) => `<g transform="rotate(-8 60 18)"><circle cx="45" cy="6" r="11.5" fill="${p.accent}"></circle><circle cx="75" cy="6" r="11.5" fill="${p.accent}"></circle><circle cx="60" cy="0" r="13" fill="${p.accent}"></circle><circle cx="54" cy="-4" r="3.2" fill="#FFFFFF" opacity="0.4"></circle><rect x="38" y="10" width="44" height="15" rx="6" fill="${p.deep}"></rect></g>`;
const chefFace = (p) => `${eyes(p)}${cheeks(p)}${snout(p)}<path d="M54 96 Q60 101 66 96" fill="none" stroke="${p.mouth}" stroke-width="2.8" stroke-linecap="round"></path>`;
const starFace = (p) => `${cheeks(p)}<path d="M50 56 Q60 51 70 56" fill="none" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"></path><path d="${star(37, 58, 16)}" fill="${GOLD}" stroke="${p.starEdge}" stroke-width="3" stroke-linejoin="round"></path><path d="${star(83, 58, 16)}" fill="${GOLD}" stroke="${p.starEdge}" stroke-width="3" stroke-linejoin="round"></path><path d="M31 52 L37 50 M77 52 L83 50" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"></path>${snout(p)}<path d="M53 96 Q63 102 70 92" fill="none" stroke="${p.mouth}" stroke-width="2.8" stroke-linecap="round"></path>`;

export function head(p, look, rim) {
  return `${rim ? headRim() : ''}${earsAndHead(p)}${look === 'star' ? starFace(p) : chefFace(p) + chefHat(p)}`;
}

// ---------- full body, in a 240-wide frame ----------
const BODY = 'M120 126 C156 126 176 148 176 176 C176 202 154 216 120 216 C86 216 64 202 64 176 C64 148 84 126 120 126 Z';
const TAIL = 'M174 154 C190 156 199 144 192 135 C186 129 177 134 181 141 C184 146 191 144 191 139';
// Four limbs, standing upright: two feet, the left hoof up in a wave, the right hoof resting.
const FEET = [[90, 198], [130, 198]];
const WAVE = 'M74 166 L56 142';
const REST = 'M165 168 L172 191';
function body(p, look, rim) {
  const out = [];
  if (rim) out.push(`<g fill="${RIM}" stroke="${RIM}" stroke-width="6" stroke-linejoin="round"><path d="${BODY}"></path>${FEET.map(([x, y]) => `<rect x="${x}" y="${y}" width="22" height="28" rx="11"></rect>`).join('')}<path d="${WAVE}" stroke-width="26" stroke-linecap="round"></path><path d="${REST}" stroke-width="24" stroke-linecap="round"></path></g>`);
  out.push(`<ellipse cx="120" cy="228" rx="52" ry="5" fill="#000000" opacity="0.14"></ellipse>`);
  out.push(`<path d="${TAIL}" fill="none" stroke="${rim ? RIM : p.accent}" stroke-width="6" stroke-linecap="round"></path>`);
  for (const [x, y] of FEET) out.push(`<rect x="${x}" y="${y}" width="22" height="28" rx="11" fill="${p.skin}"></rect><rect x="${x}" y="${y + 18}" width="22" height="10" rx="5" fill="${p.accent}"></rect><path d="M${x + 11} ${y + 20} V${y + 28}" stroke="${p.deep}" stroke-width="1.8"></path>`);
  out.push(`<path d="${BODY}" fill="${p.skin}"></path><ellipse cx="120" cy="184" rx="33" ry="22" fill="${p.shade}"></ellipse>`);
  out.push(`<path d="${WAVE}" stroke="${p.skin}" stroke-width="20" stroke-linecap="round"></path><path d="M57.5 144 L54 139" stroke="${p.accent}" stroke-width="20" stroke-linecap="round"></path><path d="M49 136 L57 142" stroke="${p.deep}" stroke-width="1.8" stroke-linecap="round"></path>`);
  out.push(`<path d="${REST}" stroke="${p.skin}" stroke-width="18" stroke-linecap="round"></path><path d="M171 188 L172.5 192" stroke="${p.accent}" stroke-width="18" stroke-linecap="round"></path><path d="M166 195 L178 191" stroke="${p.deep}" stroke-width="1.8" stroke-linecap="round"></path>`);
  if (look === 'star') out.push(`<path d="M88 150 Q120 186 152 150" fill="none" stroke="${GOLD}" stroke-width="5" stroke-dasharray="1 8" stroke-linecap="round"></path><path d="${star(120, 172, 11)}" fill="${GOLD}" stroke="${GOLD}" stroke-width="2" stroke-linejoin="round"></path>`);
  return out.join('');
}
export function full(p, look, rim) {
  return `${body(p, look, rim)}<g transform="translate(42 -4) scale(1.3)">${head(p, look, rim)}</g>`;
}

// The home-screen icon: the head without the hat, inside the safe zone of a round or square mask.
export function icon(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-26 -30 172 172"><rect x="-26" y="-30" width="172" height="172" fill="${p.accent}"/>${earsAndHead(p)}${chefFace(p)}</svg>\n`;
}

export function allLooks(p) {
  return {
    headChef: head(p, 'chef', false),
    headChefRim: head(p, 'chef', true),
    headStar: head(p, 'star', false),
    headStarRim: head(p, 'star', true),
    fullChef: full(p, 'chef', false),
    fullChefRim: full(p, 'chef', true),
    fullStarRim: full(p, 'star', true),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--preview')) {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [k, allLooks(p)]))));
  } else {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const file = new URL('../packages/core/src/art.ts', import.meta.url);
    const src = readFileSync(file, 'utf8');
    const looks = allLooks(PALETTES[process.env.MASCOT_PALETTE || 'black']);
    const start = src.indexOf('export const ART');
    const end = src.indexOf('};', start) + 2;
    const art = `export const ART: Record<string, string> = {\n${Object.entries(looks).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n};`;
    writeFileSync(file, src.slice(0, start) + art + src.slice(end));
    const svg = icon(PALETTES[process.env.MASCOT_PALETTE || 'black']);
    for (const app of ['app', 'site']) writeFileSync(new URL(`../apps/${app}/public/icon.svg`, import.meta.url), svg);
    console.log('mascot written to packages/core/src/art.ts and both icon.svg files');
  }
}
