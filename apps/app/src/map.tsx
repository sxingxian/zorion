import type { ReactNode } from 'react';
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
  const W = 390;
  const H = 260;
  const all = [...people, ...places, ...(middle ? [middle] : []), ...(target ? [target] : [])];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const cLat = all.length ? (Math.max(...lats) + Math.min(...lats)) / 2 : 0;
  const cLng = all.length ? (Math.max(...lngs) + Math.min(...lngs)) / 2 : 0;
  const k = Math.cos((cLat * Math.PI) / 180) || 1;
  const dLat = all.length ? Math.max(Math.max(...lats) - Math.min(...lats), 0.002) : 0.002;
  const dLng = all.length ? Math.max((Math.max(...lngs) - Math.min(...lngs)) * k, 0.002) : 0.002;
  const fit = Math.min((H - 90) / dLat, (W - 90) / dLng);
  const xy = (p: MapPoint): [number, number] => [W / 2 + (p.lng - cLng) * k * fit, H / 2 - (p.lat - cLat) * fit];
  const hub = target ?? middle ?? null;
  const [hx, hy] = hub ? xy(hub) : [W / 2, H / 2];
  const roads: ReactNode[] = [];
  for (let i = 0; i < 7; i++) roads.push(<path key={`v${i}`} d={`M${30 + i * 58} 0 V${H}`} stroke="var(--road)" strokeWidth={i % 3 === 0 ? 9 : 5} />);
  for (let i = 0; i < 5; i++) roads.push(<path key={`h${i}`} d={`M0 ${24 + i * 54} H${W}`} stroke="var(--road)" strokeWidth={i % 2 === 0 ? 9 : 5} />);
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
      <rect width={W} height={H} fill="var(--map)" />
      <path d={`M0 ${H - 46} Q${W / 3} ${H - 80} ${W} ${H - 30} V${H} H0 Z`} fill="var(--water)" />
      <rect x={250} y={30} width={92} height={62} rx={14} fill="var(--park)" />
      {roads}
      {hub && <circle cx={hx} cy={hy} r={70} fill="var(--accent)" opacity={0.28} className="pulse" />}
      {routes && hub && people.map((p, i) => {
        const [x, y] = xy(p);
        return <path key={i} d={`M${x} ${y} H${hx} V${hy}`} fill="none" stroke="var(--text)" strokeWidth={3} strokeDasharray="7 7" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'dash 1.4s linear infinite' }} />;
      })}
      {places.map((p, i) => {
        const [x, y] = xy(p);
        return <g key={`p${i}`}><circle cx={x} cy={y} r={9} fill="var(--bg)" stroke="var(--text)" strokeWidth={2.5} />{p.label && <text x={x} y={y - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)">{p.label}</text>}</g>;
      })}
      {people.map((p, i) => {
        const [x, y] = xy(p);
        return <g key={`u${i}`}><circle cx={x} cy={y} r={14} fill="var(--sel)" /><text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--sel-text)">{(p.label ?? '?')[0]}</text></g>;
      })}
      {hub && (
        <g>
          <circle cx={hx} cy={hy} r={25} fill="#fff" stroke="#0b0b0d" strokeWidth={2} />
          <g transform={`translate(${hx - 19} ${hy - 18}) scale(0.32)`} dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
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
