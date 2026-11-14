import { expect, it } from 'vitest';
import { testDb } from './testing';

it('applies every migration and seeds categories, ad placements and settings', async () => {
  const db = await testDb();
  const cats = await db.query('select key from categories order by position');
  expect(cats.map((c) => c.key)).toEqual(['pizza', 'ramen', 'tacos', 'bar', 'cocktail', 'izakaya']);
  expect((await db.query('select count(*)::int as n from ad_placements'))[0]!.n).toBe(3);
  expect((await db.query("select value from settings where key = 'places_provider'"))[0]!.value).toBe('osm');
  await db.close();
});
