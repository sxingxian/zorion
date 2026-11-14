// Free map tiles the admin can choose between. Tiles load straight from the service in each person's
// browser: the service sees their network address and the area they're looking at, nothing else.
export type TileSourceKey = 'onemap' | 'openfreemap' | 'versatiles' | 'maptoolkit';
export interface TileSource {
  key: TileSourceKey;
  name: string;
  note: string;
  /** Raster tiles (OneMap) or a full MapLibre style (the OpenStreetMap services). */
  raster?: { tiles: string[]; tileSize: number; minzoom: number; maxzoom: number; attribution: string };
  style?: string;
  singaporeOnly?: boolean;
  /** Origins the app's Content-Security-Policy must allow for this source. */
  origins: string[];
}
export const TILE_SOURCES: Record<TileSourceKey, TileSource> = {
  onemap: {
    key: 'onemap', name: 'OneMap', note: 'Singapore Land Authority basemap. 3D buildings from OpenFreeMap.', singaporeOnly: true,
    raster: { tiles: ['https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 11, maxzoom: 19, attribution: '<a href="https://www.onemap.gov.sg" target="_blank" rel="noopener">OneMap</a> © contributors | Singapore Land Authority' },
    origins: ['https://www.onemap.gov.sg', 'https://tiles.openfreemap.org'],
  },
  openfreemap: { key: 'openfreemap', name: 'OpenFreeMap', note: 'OpenStreetMap, with 3D buildings.', style: 'https://tiles.openfreemap.org/styles/liberty', origins: ['https://tiles.openfreemap.org'] },
  versatiles: { key: 'versatiles', name: 'VersaTiles', note: 'OpenStreetMap, flat.', style: 'https://tiles.versatiles.org/assets/styles/colorful/style.json', origins: ['https://tiles.versatiles.org'] },
  maptoolkit: { key: 'maptoolkit', name: 'Maptoolkit', note: 'OpenStreetMap. Free for small businesses; check it fits.', style: 'https://styles.maptoolkit.org/summer.json', origins: ['https://styles.maptoolkit.org', 'https://tiles.maptoolkit.org', 'https://*.maptoolkit.org'] },
};
/** OpenFreeMap's vector tiles, used for 3D buildings over a raster basemap. */
export const BUILDINGS_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const SG_TILE_CHOICES: TileSourceKey[] = ['onemap', 'openfreemap'];
export const WORLD_TILE_CHOICES: TileSourceKey[] = ['openfreemap', 'versatiles', 'maptoolkit'];
export interface MapSettings { sg: TileSourceKey; world: TileSourceKey; backup: TileSourceKey[]; start3d: boolean; buildings: boolean; animate: boolean }
export const DEFAULT_MAP_SETTINGS: MapSettings = { sg: 'onemap', world: 'openfreemap', backup: ['openfreemap', 'versatiles'], start3d: true, buildings: true, animate: true };
export function tidyMapSettings(raw: Partial<Record<string, unknown>>): MapSettings {
  const pick = (v: unknown, allowed: TileSourceKey[], d: TileSourceKey) => (allowed.includes(v as TileSourceKey) ? (v as TileSourceKey) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const backup = Array.isArray(raw.backup) ? (raw.backup as unknown[]).filter((k): k is TileSourceKey => WORLD_TILE_CHOICES.includes(k as TileSourceKey)) : DEFAULT_MAP_SETTINGS.backup;
  return {
    sg: pick(raw.sg, SG_TILE_CHOICES, 'onemap'), world: pick(raw.world, WORLD_TILE_CHOICES, 'openfreemap'), backup: [...new Set(backup)],
    start3d: bool(raw.start3d, true), buildings: bool(raw.buildings, true), animate: bool(raw.animate, true),
  };
}
