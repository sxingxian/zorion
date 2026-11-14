// The 3D map engine, loaded only when a map is on screen. MapLibre GL draws the tiles; the tiles come
// straight from the free service the admin chose (OneMap in Singapore, OpenFreeMap and others elsewhere).
// The worker runs from our own origin (worker-src 'self'), so no blob: workers are needed.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection } from 'geojson';
import { ART, BUILDINGS_TILEJSON, type MapSettings, TILE_SOURCES, type TileSourceKey } from '@zorion/core';
import type { MapData } from './meetupmap';

maplibregl.setWorkerUrl(workerUrl);

const DASHES: number[][] = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function circle(lng: number, lat: number, metres: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    out.push([lng + (metres * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (metres * Math.cos(a)) / 111_320]);
  }
  return out;
}

/** Tile choices in order: the admin's choice for this region, then the backups. */
function tileOrder(data: MapData, s: MapSettings): TileSourceKey[] {
  const first = data.singapore ? s.sg : s.world;
  return [...new Set([first, ...s.backup].filter((k) => !TILE_SOURCES[k].singaporeOnly || data.singapore))];
}

function styleFor(key: TileSourceKey, buildings: boolean): maplibregl.StyleSpecification | string {
  const src = TILE_SOURCES[key];
  if (src.raster) {
    return {
      version: 8,
      sources: {
        base: { type: 'raster', tiles: src.raster.tiles, tileSize: src.raster.tileSize, minzoom: src.raster.minzoom, maxzoom: src.raster.maxzoom, attribution: src.raster.attribution },
        ...(buildings ? { ofm: { type: 'vector', url: BUILDINGS_TILEJSON } } : {}),
      },
      layers: [
        { id: 'base', type: 'raster', source: 'base' },
        ...(buildings ? [{
          id: 'z-buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 14,
          paint: { 'fill-extrusion-color': '#e4e4ea', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 },
        } as maplibregl.LayerSpecification] : []),
      ],
    };
  }
  return src.style!;
}

export function createMap(container: HTMLElement, first: MapData, settings: MapSettings, opts: { compact?: boolean; onFail: () => void }) {
  let data = first;
  const order = tileOrder(data, settings);
  let tileIndex = 0;
  let errors = 0;
  let three = settings.start3d;
  const animate = settings.animate && !reduced();
  const markers: maplibregl.Marker[] = [];

  const map = new maplibregl.Map({
    container,
    style: styleFor(order[0]!, settings.buildings),
    center: data.centre ? [data.centre.lng, data.centre.lat] : [103.85, 1.29],
    zoom: 14,
    pitch: three ? 55 : 0,
    bearing: three ? -18 : 0,
    attributionControl: { compact: true },
    cooperativeGestures: opts.compact,
    maxPitch: 70,
    // Sharp enough on any screen; drawing at 3x on high-density phones costs over twice the work for no visible gain.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  });

  // A tile service that keeps failing is swapped for the next in the admin's order.
  map.on('error', (e) => {
    const err = (e as { error?: { status?: number; message?: string } }).error;
    if (!err) return;
    errors++;
    if (errors >= 6 && tileIndex < order.length - 1) {
      errors = 0;
      tileIndex++;
      map.setStyle(styleFor(order[tileIndex]!, settings.buildings));
    } else if (errors >= 20 && tileIndex === order.length - 1) {
      opts.onFail();
    }
  });

  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
  const routeFeatures = () => fc(data.routes.filter((r) => r.line.length >= 2).map((r) => ({ type: 'Feature', properties: { kind: r.kind }, geometry: { type: 'LineString', coordinates: r.line } })));
  const roughFeatures = () => fc(data.people.filter((p) => p.kind === 'rough').map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(p.lng, p.lat, data.roughRadius)] } })));

  function overlays() {
    if (!settings.buildings) for (const l of map.getStyle().layers ?? []) if (l.type === 'fill-extrusion') map.setLayoutProperty(l.id, 'visibility', 'none');
    map.addSource('rough', { type: 'geojson', data: roughFeatures() });
    map.addLayer({ id: 'rough-fill', type: 'fill', source: 'rough', paint: { 'fill-color': '#0b0b0d', 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'rough-line', type: 'line', source: 'rough', paint: { 'line-color': '#0b0b0d', 'line-opacity': 0.45, 'line-width': 2, 'line-dasharray': [2, 2] } });
    map.addSource('routes', { type: 'geojson', data: routeFeatures() });
    map.addLayer({ id: 'routes-case', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['match', ['get', 'kind'], 'you', 10, 8] } });
    map.addLayer({ id: 'routes-base', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'rough', '#6b6b74', '#0b0b0d'], 'line-opacity': 0.25, 'line-width': ['match', ['get', 'kind'], 'you', 6, 4] } });
    map.addLayer({ id: 'routes-dash', type: 'line', source: 'routes', layout: { 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'rough', '#6b6b74', '#0b0b0d'], 'line-width': ['match', ['get', 'kind'], 'you', 6, 4], 'line-dasharray': DASHES[0]! } });
  }

  function placeMarkers() {
    markers.splice(0).forEach((m) => m.remove());
    const add = (html: string, lng: number, lat: number, anchor: maplibregl.PositionAnchor = 'bottom', label?: string) => {
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = html;
      if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); }
      markers.push(new maplibregl.Marker({ element: el, anchor }).setLngLat([lng, lat]).addTo(map));
    };
    if (data.middle && data.dest?.kind !== 'place') add(`<span class="mk-mid"><svg viewBox="-6 -14 132 126" width="34" height="32" aria-hidden="true">${ART.headChef}</svg></span><i class="mk-stem"></i>`, data.middle.lng, data.middle.lat, 'bottom', 'The middle');
    for (const p of data.places) add(`<span class="mk-num${p.chosen ? ' on' : ''}">${p.n}</span><i class="mk-stem"></i>`, p.lng, p.lat, 'bottom', `${p.n}. ${esc(p.name)}`);
    for (const p of data.people) {
      if (p.kind === 'you') add('<span class="mk-pill">You</span><i class="mk-stem"></i>', p.lng, p.lat, 'bottom', 'You');
      else if (p.kind === 'shared') add(`<span class="mk-pill light">${esc(p.name ?? '')}</span><i class="mk-stem"></i>`, p.lng, p.lat, 'bottom', esc(p.name ?? ''));
    }
  }

  function fit(animateMove = false) {
    const pts: [number, number][] = [...data.people.map((p): [number, number] => [p.lng, p.lat]), ...data.places.map((p): [number, number] => [p.lng, p.lat]), ...(data.middle ? [[data.middle.lng, data.middle.lat] as [number, number]] : [])];
    if (pts.length === 0) return;
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: opts.compact ? 36 : 64, maxZoom: 16, pitch: three ? 55 : 0, bearing: three ? -18 : 0, duration: animateMove ? 900 : 0 });
  }

  // Animation: marching dashes along every route, and a dot travelling each one toward the middle.
  // The dots are DOM markers moved with a CSS transform, so they never make the map re-tile or redraw.
  // Only the dash pattern repaints the map, about 11 times a second. Everything stops while the map is
  // off screen or the tab is hidden.
  const lengths = () => data.routes.map((r) => { const acc = [0]; for (let i = 1; i < r.line.length; i++) { const [a, b] = [r.line[i - 1]!, r.line[i]!]; acc.push(acc[i - 1]! + Math.hypot(b[0] - a[0], (b[1] - a[1]))); } return acc; });
  let cum = lengths();
  let frame = 0;
  let step = -1;
  let onScreen = true;
  let dots: maplibregl.Marker[] = [];
  const along = (line: [number, number][], acc: number[], t: number): [number, number] => {
    const total = acc[acc.length - 1]!;
    const d = t * total;
    const i = acc.findIndex((x) => x >= d);
    if (i <= 0) return line[0]!;
    const f = (d - acc[i - 1]!) / Math.max(acc[i]! - acc[i - 1]!, 1e-12);
    return [line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * f, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * f];
  };
  function placeDots() {
    dots.splice(0).forEach((m) => m.remove());
    if (!animate) return;
    dots = data.routes.filter((r) => r.line.length >= 2).map((r) => {
      const el = document.createElement('div');
      el.className = `mk-dot${r.kind === 'you' ? ' you' : ''}`;
      el.setAttribute('aria-hidden', 'true');
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(r.line[0]!).addTo(map);
    });
  }
  function tick(ts: number) {
    frame = 0;
    if (!onScreen || document.visibilityState !== 'visible') return;
    frame = requestAnimationFrame(tick);
    if (!map.getLayer('routes-dash')) return;
    const s = Math.floor(ts / 90) % DASHES.length;
    if (s !== step) { step = s; map.setPaintProperty('routes-dash', 'line-dasharray', DASHES[s]!); }
    const routes = data.routes.filter((r) => r.line.length >= 2);
    routes.forEach((r, i) => {
      const period = 4200 + i * 500;
      const t = ((ts + i * 700) % period) / period;
      dots[i]?.setLngLat(along(r.line, cum[data.routes.indexOf(r)]!, t));
    });
  }
  const resume = () => { if (animate && !frame && onScreen && document.visibilityState === 'visible') frame = requestAnimationFrame(tick); };
  const seen = new IntersectionObserver(([e]) => { onScreen = !!e?.isIntersecting; resume(); });
  seen.observe(container);
  document.addEventListener('visibilitychange', resume);

  map.on('style.load', () => { overlays(); });
  map.once('load', () => { placeMarkers(); placeDots(); fit(); resume(); });

  return {
    update(next: MapData) {
      data = next;
      cum = lengths();
      (map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(routeFeatures());
      (map.getSource('rough') as maplibregl.GeoJSONSource | undefined)?.setData(roughFeatures());
      placeMarkers();
      placeDots();
      fit(true);
    },
    set3d(on: boolean) { three = on; map.easeTo({ pitch: on ? 55 : 0, bearing: on ? -18 : 0, duration: reduced() ? 0 : 700 }); },
    recentre() { fit(true); },
    destroy() { cancelAnimationFrame(frame); seen.disconnect(); document.removeEventListener('visibilitychange', resume); markers.forEach((m) => m.remove()); dots.forEach((m) => m.remove()); map.remove(); },
  };
}
