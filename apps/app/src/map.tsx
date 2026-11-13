import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { ART } from '@zorion/core';

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

/**
 * A drawn map, not a tile map: it shows how the crew, the middle and the places sit
 * relative to each other without sending anyone's position to a map provider.
 */
export function CrewMap({ people = [], middle, places = [], target, routes = false, label }: { people?: MapPoint[]; middle?: MapPoint | null; places?: MapPoint[]; target?: MapPoint | null; routes?: boolean; label: string }) {
  // The drawing takes the shape of its box, so nothing is cropped on a tall desktop pane or a short phone strip.
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 390, h: 260 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) setBox((b) => (Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = box.w;
  const H = box.h;
  const s = Math.min(Math.max(Math.min(W, H) / 260, 1), 1.8); // marks grow a little on big panes
  const pad = 56 * s;
  const all = [...people, ...places, ...(middle ? [middle] : []), ...(target ? [target] : [])];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const cLat = all.length ? (Math.max(...lats) + Math.min(...lats)) / 2 : 0;
  const cLng = all.length ? (Math.max(...lngs) + Math.min(...lngs)) / 2 : 0;
  const k = Math.cos((cLat * Math.PI) / 180) || 1;
  const dLat = all.length ? Math.max(Math.max(...lats) - Math.min(...lats), 0.002) : 0.002;
  const dLng = all.length ? Math.max((Math.max(...lngs) - Math.min(...lngs)) * k, 0.002) : 0.002;
  const fit = Math.min((H - pad * 2) / dLat, (W - pad * 2) / dLng);
  const xy = (p: MapPoint): [number, number] => [W / 2 + (p.lng - cLng) * k * fit, H / 2 - (p.lat - cLat) * fit];
  const hub = target ?? middle ?? null;
  const [hx, hy] = hub ? xy(hub) : [W / 2, H / 2];
  const gap = 58 * s;
  const roads: ReactNode[] = [];
  for (let i = 0, x = gap / 2; x < W; i++, x += gap) roads.push(<path key={`v${i}`} d={`M${x} 0 V${H}`} stroke="var(--road)" strokeWidth={(i % 3 === 0 ? 9 : 5) * s} />);
  for (let i = 0, y = gap * 0.4; y < H; i++, y += gap * 0.93) roads.push(<path key={`h${i}`} d={`M0 ${y} H${W}`} stroke="var(--road)" strokeWidth={(i % 2 === 0 ? 9 : 5) * s} />);
  // With many places the names would collide, so the markers carry the same numbers as the list.
  const numbered = places.length > 3;
  return (
    <svg ref={ref} className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect width={W} height={H} fill="var(--map)" />
      <path d={`M0 ${H - 46 * s} Q${W / 3} ${H - 80 * s} ${W} ${H - 30 * s} V${H} H0 Z`} fill="var(--water)" />
      <rect x={W * 0.64} y={30 * s} width={92 * s} height={62 * s} rx={14 * s} fill="var(--park)" />
      {roads}
      {hub && <circle cx={hx} cy={hy} r={70 * s} fill="var(--accent)" opacity={0.28} className="pulse" />}
      {routes && hub && people.map((p, i) => {
        const [x, y] = xy(p);
        return <path key={i} d={`M${x} ${y} H${hx} V${hy}`} fill="none" stroke="var(--text)" strokeWidth={3 * s} strokeDasharray={`${7 * s} ${7 * s}`} strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'dash 1.4s linear infinite' }} />;
      })}
      {places.map((p, i) => {
        const [x, y] = xy(p);
        if (hub && Math.hypot(x - hx, y - hy) < 30 * s) return null; // the mascot is standing on it
        const left = x < hx;
        return (
          <g key={`p${i}`}>
            <circle cx={x} cy={y} r={(numbered ? 11 : 9) * s} fill="var(--bg)" stroke="var(--text)" strokeWidth={2.5 * s} />
            {numbered ? <text x={x} y={y + 4 * s} textAnchor="middle" fontSize={11 * s} fontWeight={700} fill="var(--text)">{i + 1}</text>
              : p.label && <text x={x + (left ? -15 : 15) * s} y={y + 4 * s} textAnchor={left ? 'end' : 'start'} fontSize={11 * s} fontWeight={700} fill="var(--text)" stroke="var(--map)" strokeWidth={3 * s} paintOrder="stroke">{p.label}</text>}
          </g>
        );
      })}
      {people.map((p, i) => {
        const [x, y] = xy(p);
        return <g key={`u${i}`}><circle cx={x} cy={y} r={14 * s} fill="var(--sel)" /><text x={x} y={y + 4 * s} textAnchor="middle" fontSize={12 * s} fontWeight={700} fill="var(--sel-text)">{(p.label ?? '?')[0]}</text></g>;
      })}
      {hub && (
        <g>
          <circle cx={hx} cy={hy} r={25 * s} fill="#fff" stroke="#0b0b0d" strokeWidth={2 * s} />
          <g transform={`translate(${hx - 19 * s} ${hy - 18 * s}) scale(${0.32 * s})`} dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
        </g>
      )}
    </svg>
  );
}

/**
 * Nobody's real position is ever sent to another person's screen. For the map we place each
 * person on a ring around the hub at a distance that matches their travel time only.
 */
export function ring(hub: MapPoint, people: Array<{ name: string; minutes: number | null }>): MapPoint[] {
  const shown = people.filter((p) => p.minutes !== null);
  return shown.map((p, i) => {
    const angle = (i / Math.max(shown.length, 1)) * Math.PI * 2 + 0.6;
    const metres = (p.minutes ?? 0) * 60;
    return { lat: hub.lat + (Math.sin(angle) * metres) / 111320, lng: hub.lng + (Math.cos(angle) * metres) / (111320 * (Math.cos((hub.lat * Math.PI) / 180) || 1)), label: p.name };
  });
}
