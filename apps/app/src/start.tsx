import { useEffect, useId, useRef, useState } from 'react';
import { useAction } from './lib';
import { locate } from './ui';
import { LookupCredit } from './sources';
import { Btn, Note, Oops, Pick } from './ui';

interface Match { label: string; lat: number; lng: number }
export interface Lookup { results: Match[]; source?: string | null }

/**
 * Type a station, street or postcode instead of sharing GPS. The lookup runs on a button press,
 * not while typing, so the words leave the device only when the person asks for them to.
 */
export function StartPicker({ search, onPick, saving }: { search: (q: string) => Promise<Lookup>; onPick: (at: { lat: number; lng: number; label: string }) => void; saving?: boolean }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [chosen, setChosen] = useState(-1);
  const [run, busy, error] = useAction();
  const id = useId();
  // Opened by a tap on "Type a place": bring the box clear of the bottom bar, with the cursor in it.
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
      {matches && matches.length > 0 && <Btn type="button" className="fit" busy={saving} disabled={chosen < 0} onClick={() => { const p = matches[chosen]; if (p) onPick({ lat: p.lat, lng: p.lng, label: p.label.split(', ')[0]! }); }}>Use this</Btn>}
    </form>
  );
}

export type Start = { lat: number; lng: number; label?: string };

/**
 * "Your start": one card for host and guest. It says what is set, and both ways of setting it act at once:
 * "Use my location" asks the device and saves; "Type a place" opens the search in the same card.
 */
export function StartCard({ isSet, label, search, save, hint = 'Not set yet', titled = true }: { isSet: boolean; label: string | null; search: (q: string) => Promise<Lookup>; save: (at: Start) => Promise<unknown>; hint?: string; titled?: boolean }) {
  const [changing, setChanging] = useState(false);
  const [typing, setTyping] = useState(false);
  const [run, busy, error, clear] = useAction();
  const open = !isSet || changing;
  const finish = () => { setChanging(false); setTyping(false); };
  const useGps = () => run(async () => { await save(await locate()); finish(); });
  const pick = (at: Start) => run(async () => { await save(at); finish(); });
  const cancel = () => { clear(); finish(); };
  return (
    <section className="card stack startcard" aria-label="Your start" style={{ gap: 12 }}>
      {(titled || isSet) && <div className="row between" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <strong>Your start</strong>
          <span className="small" style={{ overflowWrap: 'anywhere' }}>{isSet ? (label ? `From ${label}` : 'From your location') : hint}</span>
        </div>
        {isSet && !open && <button type="button" className="btn second sm" onClick={() => { clear(); setChanging(true); }}>Change</button>}
      </div>}
      {open && !typing && (
        <div className="grid2">
          <Btn kind="second" busy={busy} onClick={useGps}>Use my location</Btn>
          <Btn kind="second" disabled={busy} onClick={() => { clear(); setTyping(true); }}>Type a place</Btn>
        </div>
      )}
      {open && typing && <StartPicker saving={busy} search={search} onPick={pick} />}
      <Oops>{error}</Oops>
      {open && (typing || isSet) && (
        <div className="row between">
          {typing ? <button type="button" className="linkbtn" disabled={busy} onClick={useGps}>Use my location instead</button> : <span />}
          {(typing || isSet) && <button type="button" className="linkbtn" onClick={() => (isSet ? cancel() : (clear(), setTyping(false)))}>{isSet ? 'Cancel' : 'Back'}</button>}
        </div>
      )}
    </section>
  );
}
