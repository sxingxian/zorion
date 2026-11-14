import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BLOCK, COLOURS, CREW, DASH, DISC, FOV, MIDDLE, PIN, WATER, cells, dashes, distance } from './city';

/**
 * The hero's city as a flat plan: what the 3D camera sees from straight above, at the same scale and
 * with the fair middle under the same spot (the bottom of `target`). It is the first paint, and the
 * whole map for reduced motion or devices without WebGL; the 3D scene opens from exactly this view.
 */
export function CityPlan({ className, target }: { className: string; target: RefObject<HTMLElement | null> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; tx: number; ty: number } | null>(null);
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const r = target.current?.getBoundingClientRect();
      // Same rule as the 3D scene: the middle sits just above the bottom of the pig.
      setBox({ w: b.width, h: b.height, tx: r && r.width ? r.left + r.width / 2 - b.left : b.width / 2, ty: r && r.height ? r.bottom - r.height * 0.06 - b.top : b.height * 0.62 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (target.current) ro.observe(target.current);
    return () => ro.disconnect();
  }, [target]);
  const all = useMemo(cells, []);
  const spots = useMemo(dashes, []);

  let body = null;
  if (box) {
    const { w, h, tx, ty } = box;
    const D = distance(w, 1); // the camera's height above the city in the plan view
    const s = h / (2 * D * Math.tan((FOV * Math.PI) / 360)); // pixels per block on the ground
    // Things above the ground look a little bigger and further out, as they do to the camera.
    const at = (x: number, z: number, y = 0) => { const k = D / (D - y); return [tx + (x - MIDDLE.x) * s * k, ty + (z - MIDDLE.z) * s * k, s * k] as const; };
    const half = (BLOCK / 2) * s;
    const seen = all.filter((c) => { const [x, y] = at(c.x, c.z); return x > -s && x < w + s && y > -s && y < h + s; });
    const [, waterY] = at(0, WATER.z);
    const [dx, dy, dk] = at(MIDDLE.x, MIDDLE.z, 0.2);
    body = (
      <>
        <rect width={w} height={h} fill={COLOURS.road} />
        <rect y={waterY} width={w} height={Math.max(0, h - waterY)} fill={COLOURS.water} />
        {seen.map((c) => { const [x, y] = at(c.x, c.z); return <rect key={`${c.x},${c.z}`} x={x - half} y={y - half} width={half * 2} height={half * 2} fill={c.park ? COLOURS.park : COLOURS.block} />; })}
        <circle cx={dx} cy={dy} r={DISC * dk} fill={COLOURS.pink} fillOpacity={0.42} />
        {spots.map((d, i) => { const [x, y] = at(d.x, d.z); const a = (d.alongX ? DASH.length : DASH.width) * s; const b = (d.alongX ? DASH.width : DASH.length) * s; return <rect key={i} x={x - a / 2} y={y - b / 2} width={a} height={b} fill={COLOURS.ink} />; })}
        {CREW.map(([letter, x, z]) => {
          const [px, py, k] = at(x, z, PIN.height);
          return <g key={letter}><circle cx={px} cy={py} r={PIN.head * k} fill={COLOURS.ink} /><text x={px} y={py + PIN.letter * k * 0.05} fill="#fff" fontSize={PIN.letter * (84 / 128) * k} fontWeight={700} fontFamily="system-ui, sans-serif" textAnchor="middle" dominantBaseline="central">{letter}</text></g>;
        })}
      </>
    );
  }
  return <svg ref={svg} className={className} width="100%" height="100%" viewBox={box ? `0 0 ${box.w} ${box.h}` : undefined} role="img" aria-label="Map: six friends and the routes to the fair middle">{body}</svg>;
}
