// The hero's city, shared by the drawn plan (first paint, reduced motion, no WebGL) and the 3D scene,
// so the two are the same map and the 3D one can take over without a visible swap.
// Units are city blocks. x runs left to right, z runs from the far edge (negative) to the near edge.

// Blocks sit on whole numbers, so roads run along the halves. Everything that walks stays on a half.
export const COLS = 22; // blocks reach from -COLS to COLS on x
export const ROWS = 18; // and from -ROWS to ROWS on z
export const MIDDLE = { x: 1.5, z: -0.5 };
// Six friends, placed so each shows clear of the headline in the flat view and in 3D, on desktop and phones.
export const CREW: Array<[letter: string, x: number, z: number]> = [['M', -8.5, -6.5], ['J', 7.5, -9.5], ['S', -6.5, -1.5], ['L', 7.5, -4.5], ['P', -4.5, -3.5], ['D', 4.5, -1.5]];

export const BLOCK = 0.78; // a block's width; the rest is road
export const DISC = 2.3; // radius of the pink fair-middle disc
export const PIN = { head: 0.46, height: 1.14, letter: 0.62 };
export const WATER = { z: ROWS + 0.6, depth: 60 }; // water along the near edge, like the drawn maps
export const DASH = { length: 0.24, width: 0.07, start: 0.55, every: 0.42 };

/** The camera: vertical field of view, and how far it sits from the middle (further back on phones). */
export const FOV = 30;
export const PLAN_STEP_BACK = 1.45; // the flat plan view stands further back so all six friends fit
export const distance = (width: number, flat: number) => (width < 600 ? 35 : 24) * (1 + (PLAN_STEP_BACK - 1) * flat);

export const COLOURS = { road: '#ffffff', block: '#e7e7ec', park: '#d9e8d3', water: '#dce6f2', ink: '#0b0b0d', pink: '#ffa6fc' };

/** Same numbers on every visit, so the skyline does not reshuffle. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export interface Cell { x: number; z: number; height: number; park: boolean; shade: number }
/** Every block: low near the middle so the meeting point reads clearly, a small park, a little variety. */
export function cells(): Cell[] {
  const rand = seeded(20261113);
  const out: Cell[] = [];
  for (let x = -COLS; x <= COLS; x++) for (let z = -ROWS; z <= ROWS; z++) {
    const near = Math.hypot(x - MIDDLE.x, z - MIDDLE.z);
    const park = x >= 5 && x <= 7 && z >= -7 && z <= -6;
    const height = park ? 0.04 : near < 2.6 ? 0.12 : 0.14 + rand() * rand() * 0.9;
    out.push({ x, z, height, park, shade: (rand() - 0.5) * 0.03 });
  }
  return out;
}

type P = { x: number; z: number };
/** Along the road to the middle's street, then down that street: the way a person would walk it. */
export const route = (x: number, z: number): [P, P, P] => [{ x, z }, { x: MIDDLE.x, z }, { x: MIDDLE.x, z: MIDDLE.z }];

/** The dashes laid on each route, with whether each runs along x. */
export function dashes(): Array<P & { alongX: boolean }> {
  const out: Array<P & { alongX: boolean }> = [];
  for (const [, x, z] of CREW) {
    const p = route(x, z);
    for (let leg = 0; leg < 2; leg++) {
      const from = p[leg]!;
      const to = p[leg + 1]!;
      const len = Math.hypot(to.x - from.x, to.z - from.z);
      for (let d = DASH.start; d < len - 0.3; d += DASH.every) out.push({ x: from.x + ((to.x - from.x) * d) / len, z: from.z + ((to.z - from.z) * d) / len, alongX: leg === 0 });
    }
  }
  return out;
}
