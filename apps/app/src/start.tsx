import { useEffect, useId, useRef, useState } from 'react';
import { useAction } from './lib';
import { LookupCredit } from './sources';
import { Btn, Note, Oops, Pick } from './ui';

interface Match { label: string; lat: number; lng: number }
export interface Lookup { results: Match[]; source?: string | null }

/**
 * Type a station, street or postcode instead of sharing GPS. The lookup runs on a button press,
 * not while typing, so the words leave the device only when the person asks for them to.
 */
export function StartPicker({ search, onPick, saving }: { search: (q: string) => Promise<Lookup>; onPick: (at: { lat: number; lng: number }) => void; saving?: boolean }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [chosen, setChosen] = useState(-1);
  const [run, busy, error] = useAction();
  const id = useId();
  // Opened by a tap on "Type my start": bring the box clear of the bottom bar, with the cursor in it.
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.current?.scrollIntoView({ block: 'center', behavior: quiet ? 'auto' : 'smooth' });
    box.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);
  const ready = q.trim().length >= 3;
  const look = () => run(async () => { setChosen(-1); const { results: found, source: from } = await search(q.trim()); setMatches(found); setSource(from ?? null); if (found.length === 1) setChosen(0); });
  return (
    <form ref={box} className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) look(); }}>
      <div className="field">
        <label htmlFor={id}>Station, street or postcode</label>
        <div className="searchrow">
          <input id={id} className="input" value={q} maxLength={120} autoComplete="street-address" placeholder="e.g. Bugis MRT" onChange={(e) => { setQ(e.target.value.slice(0, 120)); setMatches(null); }} />
          <Btn kind="second" type="submit" disabled={!ready || busy}>Search</Btn>
        </div>
      </div>
      <Oops>{error}</Oops>
      {matches && matches.length === 0 && <Note>No matches. Try a station or postcode.</Note>}
      {matches && matches.length > 0 && (
        <div className="stack" role="radiogroup" aria-label="Places that match" style={{ gap: 8 }}>
          {matches.map((p, i) => <Pick key={`${p.lat},${p.lng},${i}`} radio on={chosen === i} onClick={() => setChosen(i)} title={p.label.split(', ')[0]} meta={p.label.split(', ').slice(1).join(', ') || undefined} />)}
          <LookupCredit source={source} />
        </div>
      )}
      {matches && matches.length > 0 && <Btn type="button" className="fit" busy={saving} disabled={chosen < 0} onClick={() => { const p = matches[chosen]; if (p) onPick({ lat: p.lat, lng: p.lng }); }}>Use this</Btn>}
    </form>
  );
}
