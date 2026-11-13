import { useState } from 'react';
import { useAction } from './lib';
import { Btn, Field, Note, Oops, Pick } from './ui';

interface Match { label: string; lat: number; lng: number }

/**
 * Type a station, street or postcode instead of sharing GPS. The lookup runs on a button press,
 * not while typing, so the words leave the device only when the person asks for them to.
 */
export function StartPicker({ search, onPick, saving }: { search: (q: string) => Promise<Match[]>; onPick: (at: { lat: number; lng: number }) => void; saving?: boolean }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [chosen, setChosen] = useState(-1);
  const [run, busy, error] = useAction();
  const ready = q.trim().length >= 3;
  const look = () => run(async () => { setChosen(-1); const found = await search(q.trim()); setMatches(found); if (found.length === 1) setChosen(0); });
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) look(); }}>
      <Field label="Station, street or postcode" value={q} onChange={(v) => { setQ(v.slice(0, 120)); setMatches(null); }} autoComplete="street-address" placeholder="For example: Bugis MRT" />
      <Btn kind="second" type="submit" busy={busy} disabled={!ready}>Search</Btn>
      <Oops>{error}</Oops>
      {matches && matches.length === 0 && <Note>Nothing matched. Try a station, a street with its number, or a postcode.</Note>}
      {matches && matches.length > 0 && (
        <div className="stack" role="radiogroup" aria-label="Places that match" style={{ gap: 8 }}>
          {matches.map((p, i) => <Pick key={`${p.lat},${p.lng},${i}`} radio on={chosen === i} onClick={() => setChosen(i)} title={p.label.split(', ')[0]} meta={p.label.split(', ').slice(1).join(', ') || undefined} />)}
        </div>
      )}
      {matches && matches.length > 0 && <Btn type="button" busy={saving} disabled={chosen < 0} onClick={() => { const p = matches[chosen]; if (p) onPick({ lat: p.lat, lng: p.lng }); }}>Start from here</Btn>}
      <p className="small">What you type is sent to a map lookup, without your name. Zorion keeps only the point you pick.</p>
    </form>
  );
}
