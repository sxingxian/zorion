/** Built-in categories. Admins can edit the live list; this is the seed and the fallback. */
export interface CategoryDef {
  key: string;
  name: string;
  icon: string;
  /** OpenStreetMap tag filters, joined with OR. */
  osm: string[];
  /** Google Places (New) type or text query. */
  google: { type?: string; text?: string };
}

export const BUILT_IN_CATEGORIES: CategoryDef[] = [
  { key: 'pizza', name: 'Pizza', icon: 'pizza', osm: ['["amenity"~"restaurant|fast_food"]["cuisine"~"pizza"]'], google: { type: 'pizza_restaurant' } },
  { key: 'ramen', name: 'Ramen', icon: 'ramen', osm: ['["amenity"~"restaurant|fast_food"]["cuisine"~"ramen|noodle"]'], google: { type: 'ramen_restaurant' } },
  { key: 'tacos', name: 'Tacos', icon: 'tacos', osm: ['["amenity"~"restaurant|fast_food"]["cuisine"~"mexican|tacos"]'], google: { type: 'mexican_restaurant' } },
  { key: 'bar', name: 'Bar', icon: 'bar', osm: ['["amenity"~"bar|pub"]'], google: { type: 'bar' } },
  { key: 'cocktail', name: 'Cocktails', icon: 'cocktail', osm: ['["amenity"="bar"]["cocktails"="yes"]', '["amenity"="bar"]["name"~"cocktail",i]'], google: { text: 'cocktail bar' } },
  { key: 'izakaya', name: 'Izakaya', icon: 'izakaya', osm: ['["amenity"~"restaurant|pub|bar"]["cuisine"~"japanese|izakaya"]'], google: { text: 'izakaya' } },
];

/** Used when a search times out or finds too little (SRS fallback set). */
export const FALLBACK_KEYS = ['pizza', 'bar', 'ramen', 'tacos'];
