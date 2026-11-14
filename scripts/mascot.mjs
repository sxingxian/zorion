// Draws Zorion the pig. One source for every look, so the head, the full body, the chef
// (free) and star (Pro) looks, and the outlined versions for dark backgrounds always match.
//   node scripts/mascot.mjs            rewrites the mascot in packages/core/src/art.ts and the app icons
//   node scripts/mascot.mjs --preview  prints JSON of every look in every palette (for mockups)
// The drawing is the soft, outlined style: a chubby head, small ears, big shiny eyes, a wide open
// smile, short front hooves from behind the shoulders, and no tail from the front.

export const PALETTES = {
  black: { body: '#2B2830', belly: '#3A3641', line: '#15131A', ear: '#FFA6FC', snout: '#FFA6FC', snoutLine: '#B94FB5', nose: '#B94FB5', blush: '#FFA6FC', blushOp: 0.6, face: '#FFFFFF', hoof: '#FFA6FC', accent: '#FFA6FC' },
  pink: { body: '#FFCBE0', belly: '#FFDDEB', line: '#6B4034', ear: '#FF9CC0', snout: '#FFAFCB', snoutLine: '#6B4034', nose: '#6B4034', blush: '#FF7FAE', blushOp: 0.5, face: '#6B4034', hoof: '#FF9CC0', accent: '#FFE3F7' },
};
const RIM = '#FFF4E6';
const GOLD = '#F5C242';
const GOLD_EDGE = '#9A6E00';
const HAT = '#FFF8EE';

const HEAD = 'M-78 10 C-78 -48 -44 -70 0 -70 C44 -70 78 -48 78 10 C78 52 46 68 0 68 C-46 68 -78 52 -78 10 Z';
const EAR = 'M-71 -30 C-86 -42 -88 -62 -76 -68 C-62 -73 -45 -65 -36 -52 Z';
const EAR_IN = 'M-69 -42 C-77 -49 -78 -59 -72 -62 C-65 -64 -56 -60 -51 -54 Z';
const BODY = 'M0 60 C36 60 56 82 56 110 C56 136 34 150 0 150 C-34 150 -56 136 -56 110 C-56 82 -36 60 0 60 Z';

const star = (cx, cy, r, k = 0.5) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const t = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * k : r;
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
};
const both = (s) => `${s}<g transform="scale(-1 1)">${s}</g>`;
const S = (c, w = 4) => `stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const el = (tag, attrs) => `<${tag} ${attrs}></${tag}>`;

function hat(p) {
  const puffs = [[-19, -90, 15], [0, -99, 18], [19, -90, 15]];
  const circles = puffs.map(([x, y, r]) => el('circle', `cx="${x}" cy="${y}" r="${r}"`)).join('');
  const band = 'x="-27" y="-84" width="54" height="19" rx="8"';
  return `<g transform="rotate(-7 0 -70)"><g fill="${p.line}" ${S(p.line, 8)}>${circles}${el('rect', band)}</g><g fill="${HAT}">${circles}</g>${el('rect', `${band} fill="#FFA6FC"`)}${el('path', `d="M-12 -100 q4 -6 10 -5" fill="none" ${S('#F3D9C2', 3)}`)}</g>`;
}
function eyes(p) {
  const dark = p.face === '#FFFFFF';
  return [-37, 37].map((x) => el('ellipse', `cx="${x}" cy="3" rx="7.8" ry="9.4" fill="${dark ? '#0B0B0D' : p.face}"${dark ? ' stroke="#FFFFFF" stroke-width="2.6"' : ''}`) + el('circle', `cx="${x - 2.4}" cy="-0.8" r="3" fill="#FFFFFF"`) + el('circle', `cx="${x + 2.8}" cy="6.6" r="1.4" fill="#FFFFFF"`)).join('');
}
function shades() {
  return el('path', `d="M-14 0 Q0 -7 14 0" fill="none" ${S(GOLD_EDGE, 5)}`) + [-37, 37].map((x) => el('path', `d="${star(x, 2, 22)}" fill="${GOLD}" ${S(GOLD_EDGE, 3.5)}`) + el('path', `d="M${x - 7} -4 l6 -3" fill="none" ${S('#FFFFFF', 3)}`)).join('');
}
// The head is drawn around (0, 0). look: 'chef' | 'star' | 'plain' (no hat, for the icon).
function headArt(p, look, rim) {
  const ring = rim ? `<g fill="${RIM}" ${S(RIM, 14)}>${both(el('path', `d="${EAR}"`))}${el('path', `d="${HEAD}"`)}</g>` : '';
  return ring
    + both(el('path', `d="${EAR}" fill="${p.body}" ${S(p.line)}`)) + both(el('path', `d="${EAR_IN}" fill="${p.ear}"`))
    + el('path', `d="${HEAD}" fill="${p.body}" ${S(p.line)}`)
    + both(el('ellipse', `cx="-54" cy="24" rx="13" ry="9" fill="${p.blush}" opacity="${p.blushOp}"`))
    + (look === 'star' ? shades() : eyes(p))
    // wide open smile, tucked under the snout
    + el('path', `d="M-16 28 Q0 36 16 28 Q13 47 0 47 Q-13 47 -16 28 Z" fill="#E8457F"`) + el('ellipse', `cx="0" cy="43" rx="6.4" ry="3.4" fill="#FFB9D6"`)
    + el('ellipse', `cx="0" cy="16" rx="20" ry="14" fill="${p.snout}" ${S(p.snoutLine, 3)}`) + el('ellipse', `cx="-7" cy="16" rx="2.6" ry="4.2" fill="${p.nose}"`) + el('ellipse', `cx="7" cy="16" rx="2.6" ry="4.2" fill="${p.nose}"`)
    + (look === 'chef' ? hat(p) : '');
}
// Standing body under the head: two feet, one front hoof waving, the other relaxed. Four limbs, no tail.
function fullArt(p, look, rim) {
  const foot = (x) => el('rect', `x="${x}" y="132" width="22" height="28" rx="11" fill="${p.body}"`) + el('path', `d="M${x} 150 h22 a11 11 0 0 1 -22 0 Z" fill="${p.hoof}"`) + el('path', `d="M${x + 11} 151 v9" fill="none" ${S(p.snoutLine, 2)}`) + el('rect', `x="${x}" y="132" width="22" height="28" rx="11" fill="none" ${S(p.line)}`);
  const box = 'x="-22" y="-11.5" width="44" height="23" rx="11.5"';
  const hoof = (tf) => `<g transform="${tf}">${el('rect', `${box} fill="${p.body}"`)}${el('path', `d="M-8 -11.5 H-10.5 A11.5 11.5 0 0 0 -10.5 11.5 H-8 Z" fill="${p.hoof}"`)}${el('path', `d="M-22 0 h8" fill="none" ${S(p.snoutLine, 2)}`)}${el('rect', `${box} fill="none" ${S(p.line)}`)}</g>`;
  const hoofRim = (tf) => `<g transform="${tf}">${el('rect', `${box} fill="${RIM}" ${S(RIM, 14)}`)}</g>`;
  const wave = 'translate(-66 84) rotate(42)';
  const rest = 'translate(60 99) scale(-1 1) rotate(-30)';
  const ring = rim ? `<g fill="${RIM}" ${S(RIM, 14)}>${el('path', `d="${BODY}"`)}${el('rect', 'x="-32" y="132" width="22" height="28" rx="11"')}${el('rect', 'x="10" y="132" width="22" height="28" rx="11"')}</g>${hoofRim(wave)}${hoofRim(rest)}` : '';
  return el('ellipse', `cx="0" cy="163" rx="56" ry="6" fill="#000000" opacity="0.12"`) + ring
    + foot(-32) + foot(10) + hoof(wave) + hoof(rest)
    + el('path', `d="${BODY}" fill="${p.body}" ${S(p.line)}`) + el('ellipse', `cx="0" cy="120" rx="30" ry="20" fill="${p.belly}"`)
    + (look === 'star' ? el('path', `d="M-30 78 Q0 110 30 78" fill="none" stroke="${GOLD}" stroke-width="5" stroke-dasharray="0.1 9" stroke-linecap="round"`) + el('path', `d="${star(0, 100, 11)}" fill="${GOLD}" ${S(GOLD_EDGE, 2.5)}`) : '')
    + `<g transform="rotate(-4 0 60)">${headArt(p, look, rim)}</g>`;
}

// The screens draw the head in a "-6 -14 132 126" view box and the full body in "0 -22 240 254".
export const head = (p, look, rim) => `<g transform="translate(60 64.1) scale(0.63)">${headArt(p, look, rim)}</g>`;
export const full = (p, look, rim) => `<g transform="translate(120 84.4) scale(0.858)">${fullArt(p, look, rim)}</g>`;

// The home-screen icon: the head without the hat, inside the safe zone of a round or square mask.
export function icon(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-26 -30 172 172"><rect x="-26" y="-30" width="172" height="172" fill="${p.accent}"/><g transform="translate(60 58) scale(0.66)">${headArt(p, 'plain', false)}</g></svg>\n`;
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
