// MapLibre's CSP build: the same library, with its worker served from our own origin.
declare module 'maplibre-gl/dist/maplibre-gl-csp.js' {
  const maplibregl: unknown;
  export default maplibregl;
}
