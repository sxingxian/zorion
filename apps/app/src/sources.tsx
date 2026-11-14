// Says where places, trip times and starting-place matches came from. Credit is required by most of
// these services (OpenStreetMap's licence, Geoapify's and OneMap's terms), and it tells people how
// far to trust a time: a routed time from a map service, or Zorion's own estimate from distance.

const PLACES: Record<string, string> = { google: 'Google Maps', geoapify: 'Geoapify', osm: 'OpenStreetMap' };
const TIMES: Record<string, string> = { google: 'Google Maps', onemap: 'OneMap', ors: 'openrouteservice', geoapify: 'Geoapify', osrm: 'OpenStreetMap routing' };
const LOOKUP: Record<string, string> = { google: 'Google Maps', onemap: 'OneMap', geoapify: 'Geoapify', osm: 'OpenStreetMap' };
// Services whose data is OpenStreetMap's, which asks for this line wherever it is shown.
const OSM_DATA = new Set(['osm', 'geoapify', 'ors', 'osrm']);

const one = (xs: Array<string | null | undefined>): string | null => {
  const set = [...new Set(xs.filter(Boolean))] as string[];
  return set.length === 1 ? set[0]! : set.length > 1 ? 'mixed' : null;
};

/** "Places: Geoapify · Trip times: OneMap", under a list of places. */
export function Credits({ places, times = true }: { places: Array<{ source?: string | null; routedBy?: string | null }>; times?: boolean }) {
  if (!places.length) return null;
  const found = one(places.map((p) => p.source));
  const routed = one(places.map((p) => p.routedBy));
  const estimated = places.some((p) => !p.routedBy);
  const parts: string[] = [];
  if (found && PLACES[found]) parts.push(`Places: ${PLACES[found]}`);
  if (times) {
    if (routed && TIMES[routed]) parts.push(`Trip times: ${TIMES[routed]}${estimated ? ', some estimated' : ''}`);
    else if (routed === 'mixed') parts.push('Trip times: several map services');
    else parts.push('Trip times: estimated from distance');
  }
  const osm = (found && OSM_DATA.has(found)) || (times && routed && OSM_DATA.has(routed));
  const onemap = times && routed === 'onemap';
  return (
    <p className="small credit">
      {parts.join(' · ')}
      {osm && <><br />© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</>}
      {onemap && <><br />OneMap © Singapore Land Authority</>}
    </p>
  );
}

/** "Results from OneMap", under starting-place matches. */
export function LookupCredit({ source }: { source?: string | null }) {
  if (!source || !LOOKUP[source]) return null;
  return (
    <p className="small credit">
      Results from {LOOKUP[source]}
      {OSM_DATA.has(source) && <> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</>}
      {source === 'onemap' && <> · © Singapore Land Authority</>}
    </p>
  );
}
