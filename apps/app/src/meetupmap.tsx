import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MAP_SETTINGS } from '@zorion/core';
import { api, useConfig } from './lib';
import { Mascot } from './ui';

/** What the server sends for the crew map (see worker/crewmap.ts). */
export interface MapData {
  people: Array<{ id: string; kind: 'you' | 'shared' | 'rough'; name: string | null; lat: number; lng: number; host: boolean }>;
  middle: { lat: number; lng: number } | null;
  places: Array<{ id: string; n: number; name: string; lat: number; lng: number; chosen: boolean }>;
  dest: { kind: 'middle' | 'place'; lat: number; lng: number } | null;
  routes: Array<{ id: string; kind: 'you' | 'shared' | 'rough'; line: [number, number][]; source: string }>;
  centre: { lat: number; lng: number } | null;
  roughRadius: number;
  singapore: boolean;
}

const webgl = (): boolean => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

/**
 * The crew map: everyone's route to the middle (or the place, once it's set), in 3D.
 * The map engine loads only when a map is on screen. Without WebGL, a flat drawing stands in.
 */
export function MeetupMap({ source, version, height = 320, compact = false }: { source: string; version: string; height?: number; compact?: boolean }) {
  const config = useConfig();
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [flat, setFlat] = useState(false);
  const [three, setThree] = useState<boolean | null>(null);
  const engine = useRef<{ update: (d: MapData) => void; set3d: (on: boolean) => void; recentre: () => void; destroy: () => void } | null>(null);
  const settings = config?.maps ?? DEFAULT_MAP_SETTINGS;

  useEffect(() => {
    let live = true;
    api<{ map: MapData }>('GET', source).then((r) => live && setData(r.map)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [source, version]);

  useEffect(() => {
    if (!data || !box.current || flat || !config) return;
    if (engine.current) { engine.current.update(data); return; }
    if (!webgl()) { setFlat(true); return; }
    let cancelled = false;
    import('./map3d').then(({ createMap }) => {
      if (cancelled || !box.current) return;
      engine.current = createMap(box.current, data, settings, { compact, onFail: () => setFlat(true) });
      setThree(settings.start3d);
    }).catch(() => setFlat(true));
    return () => { cancelled = true; };
  }, [data, flat, config]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { engine.current?.destroy(); engine.current = null; }, []);

  if (failed) return null;
  return (
    <div className="mapwrap" style={{ height }}>
      {flat && data ? <FlatMap data={data} /> : <div ref={box} className="map3d" role="img" aria-label="Map: routes from everyone to the middle" />}
      {!data && <div className="maploading"><Mascot size={48} bob label="Loading the map" /></div>}
      {!flat && engine.current && !compact && (
        <div className="mapctl">
          <button className="sq" aria-label={three ? 'Switch to 2D' : 'Switch to 3D'} onClick={() => { const next = !three; setThree(next); engine.current?.set3d(next); }}>{three ? '2D' : '3D'}</button>
          <button className="sq" aria-label="Recentre" onClick={() => engine.current?.recentre()}><svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" /><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" /></svg></button>
        </div>
      )}
    </div>
  );
}

/** A flat drawing of the same thing, for devices without WebGL. */
function FlatMap({ data }: { data: MapData }) {
  const pts = [...data.people.map((p) => [p.lng, p.lat]), ...data.places.map((p) => [p.lng, p.lat]), ...(data.middle ? [[data.middle.lng, data.middle.lat]] : []), ...data.routes.flatMap((r) => r.line)];
  if (!pts.length) return <div className="flatmap" />;
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 0.12, w = Math.max(x1 - x0, 0.002), h = Math.max(y1 - y0, 0.002);
  const X = (lng: number) => 8 + ((lng - x0) / w) * 84 * (1 - pad) + 84 * pad / 2;
  const Y = (lat: number) => 8 + (1 - (lat - y0) / h) * 84 * (1 - pad) + 84 * pad / 2;
  return (
    <svg className="flatmap" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map: routes from everyone to the middle">
      {data.routes.map((r) => <polyline key={r.id} points={r.line.map(([a, b]) => `${X(a)},${Y(b)}`).join(' ')} fill="none" stroke={r.kind === 'rough' ? '#6b6b74' : '#0b0b0d'} strokeWidth={r.kind === 'you' ? 1.4 : 1} strokeDasharray="2.4 1.6" className="march" />)}
      {data.people.filter((p) => p.kind === 'rough').map((p) => <circle key={p.id} cx={X(p.lng)} cy={Y(p.lat)} r={5} fill="rgba(11,11,13,0.1)" stroke="rgba(11,11,13,0.4)" strokeDasharray="1 1" strokeWidth={0.5} />)}
      {data.middle && data.dest?.kind !== 'place' && <circle cx={X(data.middle.lng)} cy={Y(data.middle.lat)} r={4} fill="#ffa6fc" stroke="#fff" strokeWidth={1} />}
      {data.places.map((p) => <g key={p.id}><circle cx={X(p.lng)} cy={Y(p.lat)} r={p.chosen ? 3.4 : 2.8} fill={p.chosen ? '#0b0b0d' : '#fff'} stroke="#0b0b0d" strokeWidth={0.6} /><text x={X(p.lng)} y={Y(p.lat) + 1.1} fontSize={3} textAnchor="middle" fontWeight={800} fill={p.chosen ? '#fff' : '#0b0b0d'}>{p.n}</text></g>)}
      {data.people.filter((p) => p.kind !== 'rough').map((p) => <g key={p.id}><circle cx={X(p.lng)} cy={Y(p.lat)} r={2} fill="#0b0b0d" stroke="#fff" strokeWidth={0.8} /><text x={X(p.lng)} y={Y(p.lat) - 3.4} fontSize={3.2} textAnchor="middle" fontWeight={800}>{p.kind === 'you' ? 'You' : p.name}</text></g>)}
    </svg>
  );
}
