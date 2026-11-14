// The 3D map engine, loaded only when a map is on screen. MapLibre GL draws the tiles; the tiles come
// straight from the free service the admin chose (OneMap in Singapore, OpenFreeMap and others elsewhere).
// The worker runs from our own origin (worker-src 'self'), so no blob: workers are needed.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection } from 'geojson';
import { AVATAR_ART, AVATAR_VIEWBOX, type Avatar, BUILDINGS_TILEJSON, ICONS, type MapSettings, TILE_SOURCES, type TileSourceKey } from '@zorion/core';
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

  // Markers. The pig only ever means you, at your exact start. The middle is a neutral ring; places to vote on
  // are numbered; where you're meeting gets the pink pin with the winning food's icon. Others who share their
  // pin show an initial and their name; everyone else is a rough area drawn on the map itself.
  function placeMarkers() {
    markers.splice(0).forEach((m) => m.remove());
    const add = (html: string, lng: number, lat: number, anchor: maplibregl.PositionAnchor, label: string) => {
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = html;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', label);
      markers.push(new maplibregl.Marker({ element: el, anchor }).setLngLat([lng, lat]).addTo(map));
    };
    const venue = data.dest?.kind === 'place' ? data.places.find((p) => p.chosen) : undefined;
    const voting = !venue && data.places.length > 0;
    // Each marker's own box is the round part, centred on its point; labels hang outside it (see theme.css).
    if (data.middle && !venue) add(`<span class="mk-mid${voting ? ' small' : ''}"></span>${voting ? '' : '<span class="mk-tag light below">Middle</span>'}`, data.middle.lng, data.middle.lat, 'center', 'The middle');
    if (venue) {
      const icon = data.icon && ICONS[data.icon] ? `<svg x="9" y="7" width="22" height="22" viewBox="0 0 24 24">${ICONS[data.icon]}</svg>` : '<circle cx="20" cy="18" r="5" fill="#0b0b0d"></circle>';
      add(`<svg class="mk-venue" viewBox="0 0 40 50" width="44" height="55" aria-hidden="true"><path d="M20 48 C20 48 4 31 4 18 A16 16 0 1 1 36 18 C36 31 20 48 20 48 Z" fill="#ffa6fc" stroke="#0b0b0d" stroke-width="3" stroke-linejoin="round"></path>${icon}</svg><span class="mk-tag above">${esc(venue.name)}</span>`, venue.lng, venue.lat, 'bottom', `Meeting at ${esc(venue.name)}`);
    } else {
      for (const p of data.places) add(`<span class="mk-num">${p.n}</span>`, p.lng, p.lat, 'center', `${p.n}. ${esc(p.name)}`);
    }
    for (const p of data.people) {
      if (p.kind === 'shared') add(`<span class="mk-ini">${esc([...(p.name ?? '?')][0]!.toUpperCase())}</span><span class="mk-tag light right">${esc(p.name ?? '')}</span>`, p.lng, p.lat, 'center', esc(p.name ?? ''));
    }
    const you = data.people.find((p) => p.kind === 'you');
    if (you) {
      const pig = (data.avatar && data.avatar in AVATAR_ART ? data.avatar : 'plain') as Avatar;
      add(`<span class="mk-you"><svg viewBox="${AVATAR_VIEWBOX}" width="38" height="38" aria-hidden="true">${AVATAR_ART[pig]}</svg></span><span class="mk-tag below">You</span>`, you.lng, you.lat, 'center', 'You');
    }
  }

  /** What the view frames: the place and you once it's set; the places while voting; otherwise everyone. */
  function framed(): [number, number][] {
    const at = (p: { lng: number; lat: number }): [number, number] => [p.lng, p.lat];
    const venue = data.dest?.kind === 'place' ? data.places.find((p) => p.chosen) : undefined;
    const you = data.people.filter((p) => p.kind === 'you');
    if (venue) return [at(venue), ...(you.length ? you : data.people).map(at)];
    if (data.places.length) return [...data.places.map(at), ...(data.middle ? [at(data.middle)] : [])];
    return [...data.people.map(at), ...(data.middle ? [at(data.middle)] : [])];
  }

  function fit(animateMove = false) {
    const pts = framed();
    if (pts.length === 0) return;
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: opts.compact ? 40 : 72, maxZoom: 15.5, pitch: three ? 55 : 0, bearing: three ? -18 : 0, duration: animateMove ? 900 : 0 });
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
