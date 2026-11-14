import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { LIMITS } from '@zorion/core';
import { CrewMap } from './map';
import { StartPicker } from './start';
import { Updates } from './updates';
import { ApiError, Link, api, useAction, when } from './lib';
import { Btn, Chevron, Chip, Codes, Facts, Field, Header, Icon, Loading, Mascot, Note, Oops, Pick, AdSlot, Toast, copyText, locate } from './ui';

type M = Record<string, any>;
type View = 'auto' | 'code' | 'edit' | 'dates' | 'location' | 'categories' | 'rsvp' | 'place';

export function useGuestMeetup(token: string) {
  const [m, setM] = useState<M | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const refresh = useCallback(() => api('GET', `/g/${token}`).then((r) => setM(r.meetup)).catch((e) => { if (e instanceof ApiError && (e.status === 404 || e.status === 410)) setGone(e.message); }), [token]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 10000);
    // Coming back from another app (Telegram, the inbox) shows the result straight away.
    const back = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);
  return { m, setM, gone, refresh };
}

export function GuestPane({ m }: { m: M }) {
  const place = m.status === 'confirmed' ? m.places[0] : null;
  return (
    <>
      <CrewMap label="Map of the plan" target={place ? { lat: place.lat, lng: place.lng } : null} />
      <div className="glance"><div className="display h2">At a glance</div><Facts rows={[['When', when(m.startsAt, m.timeZone)], ['Host', m.hostName], ['Food', m.winner?.name ?? 'Being voted'], ['Place', place?.name ?? (m.status === 'place_vote' ? 'Being voted' : 'Not yet')]]} /></div>
    </>
  );
}

/** Everything a guest does, from one link. The server decides what is allowed; this picks the next screen. */
export function GuestFlow({ token, m, setM }: { token: string; m: M; setM: (m: M) => void }) {
  const [run, busy, error, clear] = useAction();
  const [view, setViewRaw] = useState<View>('auto');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pickId, setPickId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [list, setList] = useState<string[]>([]);
  const [confirmedReply, setConfirmedReply] = useState(false);
  const [typing, setTyping] = useState(false);
  const setView = (v: View) => { clear(); setCode(''); setViewRaw(v); };
  const call = (path: string, body?: unknown) => run(async () => setM((await api('POST', `/g/${token}${path}`, body)).meetup));
  const me = m.me as M | null;
  const tz = m.timeZone;
  const sched = when(m.startsAt, tz);
  const hosted = `${m.dateIsSet ? sched : 'Date being voted'} · hosted by ${m.hostName}`;
  const editing = view !== 'auto' && view !== 'code';
  // Once the plan is confirmed only the reply can change, so there is no choices menu to go back to.
  const locked = m.status === 'confirmed';
  const backToEdit = editing && view !== 'edit' ? () => setView(locked ? 'auto' : 'edit') : undefined;
  const done = () => setView(editing && !locked ? 'edit' : 'auto');

  // ----- not known on this device yet -----
  if (!me) {
    if (view === 'code') {
      return (
        <main className="screen" style={{ padding: '20px 20px 24px', gap: 14 }}>
          <div className="row" style={{ gap: 14 }}><Mascot size={84} bob /><div className="stack" style={{ gap: 2 }}><span className="small" style={{ fontWeight: 600, fontSize: 14 }}>Welcome back</span><span className="display h0">{m.name}</span></div></div>
          <div className="stack"><h1 className="display h1">Enter your code</h1><p className="small" style={{ fontSize: 15 }}>The 4 characters you got when you joined.</p></div>
          <Codes big length={LIMITS.guestCodeLength} digits={false} value={code} onChange={setCode} label="Your 4-character code" />
          <Oops>{error}</Oops>
          <p className="small" style={{ fontSize: 14 }}>Lost it? {m.hostName} can reset it.</p>
          <div className="push stack" style={{ gap: 10 }}><Btn busy={busy} disabled={code.length !== LIMITS.guestCodeLength} onClick={async () => (await call('/code', { code })) && setView('auto')}>Continue</Btn><Btn kind="second" onClick={() => setView('auto')}>I'm new</Btn></div>
        </main>
      );
    }
    const free = m.people.filter((p: M) => !p.claimed);
    return (
      <main className="screen" style={{ padding: '20px 20px 24px', gap: 10 }}>
        <div className="row" style={{ gap: 14, paddingBottom: 6 }}><Mascot size={84} bob /><div className="stack" style={{ gap: 2 }}><span className="small" style={{ fontWeight: 600, fontSize: 14 }}>{m.hostName} invited you to</span><span className="display h0">{m.name}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{m.dateIsSet ? sched : 'Date to be voted'}</span></div></div>
        <h1 className="display h1">Who are you?</h1>
        <div className="stack" role="radiogroup" aria-label="Your name">
          {m.people.map((p: M) => (p.claimed ? <div key={p.id} className="pick taken"><span className="grow wrap" style={{ fontWeight: 700 }}>{p.name}</span><span className="small">Joined</span></div> : <Pick key={p.id} radio on={pickId === p.id} onClick={() => { setPickId(p.id); setName(''); }} title={p.name} />))}
        </div>
        {m.status !== 'confirmed' && <Field label="Not listed? Add your name" value={name} max={LIMITS.inviteeName} placeholder="Your name" onChange={(v) => { setName(v); setPickId(''); }} />}
        <Oops>{error}</Oops>
        <div className="push stack" style={{ gap: 2 }}>
          <Btn kind="text" onClick={() => setView('code')}>Joined before? Enter your code</Btn>
          <Btn busy={busy} disabled={!pickId && !name.trim()} onClick={() => run(async () => { const r = await api('POST', `/g/${token}/join`, pickId ? { participantId: pickId } : { name }); setNewCode(r.code); setPickId(''); setM(r.meetup); })}>{pickId ? `I am ${free.find((p: M) => p.id === pickId)?.name}` : name.trim() ? `Join as ${name.trim()}` : 'Choose your name'}</Btn>
          <a className="btn text" href="/sign-in">Have an account? Sign in</a>
          <p className="small center"><a href="/api/legal/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/api/legal/terms" target="_blank" rel="noopener">Terms</a></p>
        </div>
      </main>
    );
  }

  // ----- the code, shown once right after joining -----
  if (newCode) {
    return (
      <>
        <Header title={m.name} sub={me.name} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 16 }}>
          <span style={{ alignSelf: 'center' }}><Mascot size={88} bob /></span>
          <div className="stack"><h1 className="display h1">Keep this code</h1><p className="small" style={{ fontSize: 15 }}>You need it to change your answers or open this on another device. Lost it? {m.hostName} can reset it.</p></div>
          <Codes big readOnly length={LIMITS.guestCodeLength} digits={false} value={newCode} label="Your code" />
          <div className="push stack" style={{ gap: 10 }}><Btn onClick={() => setNewCode(null)}>Continue</Btn><Btn kind="second" onClick={async () => setToast((await copyText(newCode)) ? 'Code copied' : newCode)}>Copy code</Btn></div>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- enter the code to change something -----
  if (view === 'code') {
    return (
      <>
        <Header title={m.name} sub={`${me.name} · ${m.status === 'confirmed' ? 'change your reply' : 'change your choices'}`} onBack={() => setView('auto')} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <h1 className="display h1">Enter your code</h1>
          <Codes big length={LIMITS.guestCodeLength} digits={false} value={code} onChange={setCode} label="Your 4-character code" />
          <Oops>{error}</Oops>
          <p className="small" style={{ fontSize: 14 }}>Lost it? {m.hostName} can reset it.</p>
          <Btn className="push" busy={busy} disabled={code.length !== LIMITS.guestCodeLength} onClick={async () => (await call('/code', { code })) && setView(m.status === 'confirmed' ? 'rsvp' : 'edit')}>Continue</Btn>
        </main>
      </>
    );
  }

  const myCats = (me.categories as string[]).map((k) => m.ballot.find((b: M) => b.key === k)?.name ?? k).join(', ');
  const myDates = (me.dates as string[]).map((id) => when(m.dates.find((d: M) => d.id === id)?.startsAt ?? null, tz).split(',')[0]).join(', ');
  const myPlace = m.places.find((p: M) => p.id === me.place)?.name;
  const reply = me.rsvp === 'none' ? 'No reply yet' : me.rsvp === 'no' ? "Can't go" : me.rsvp[0].toUpperCase() + me.rsvp.slice(1);

  // ----- your choices (after the code) -----
  if (view === 'edit') {
    if (!me.canAmend) return <Redirect to={() => setView('code')} />;
    if (locked) return <Redirect to={() => setView('rsvp')} />;
    const row = (label: string, value: ReactNode, to: View, show = true) => show && <button key={label} className="pick rise" onClick={() => setView(to)}><span className="grow stack" style={{ gap: 0 }}><span className="small">{label}</span><strong>{value}</strong></span><Chevron /></button>;
    return (
      <>
        <Header title={m.name} sub={me.name} onBack={() => setView('auto')} />
        <main className="screen">
          <h1 className="display h1">Your choices</h1>
          <p className="small" style={{ fontSize: 14 }}>You can make changes for the next 10 minutes.</p>
          <div className="stack">
            {row('Reply', reply, 'rsvp', m.dateIsSet)}
            {row('Dates', myDates || 'None', 'dates', m.status === 'date_vote')}
            {row('Food', myCats || 'None yet', 'categories', ['date_vote', 'voting'].includes(m.status) && m.maxVotes > 0)}
            {row('Place', myPlace ?? 'None yet', 'place', m.status === 'place_vote')}
            {row('Starting point', me.hasLocation ? 'Shared' : 'Not shared', 'location')}
          </div>
          <Btn kind="second" className="push" onClick={() => setView('auto')}>Done</Btn>
        </main>
      </>
    );
  }

  // ----- pick the screen: an explicit edit, or the next thing this guest still has to do -----
  const need = (m.dateMode === 'vote' && !m.dateIsSet)
    ? (me.dates.length === 0 && !me.noDateWorks ? 'dates' : me.noDateWorks ? 'none' : !me.hasLocation ? 'location' : me.categories.length === 0 && m.maxVotes > 0 ? 'categories' : 'wait')
    : me.rsvp === 'none' || (me.rsvpIsDefault && !confirmedReply) ? 'rsvp'
      : me.rsvp === 'no' ? 'cant'
        : !me.hasLocation && m.status !== 'confirmed' ? 'location'
          : m.status === 'voting' && me.categories.length === 0 && m.maxVotes > 0 ? 'categories'
            : m.status === 'place_vote' && !me.place ? 'place'
              : m.status === 'confirmed' ? 'info' : 'wait';
  const screen = editing ? (locked && view !== 'rsvp' ? 'rsvp' : view) : need;

  if (screen === 'dates') {
    const sel = list.length || editing ? list : (me.dates as string[]);
    return (
      <>
        <Header title={m.name} sub={`Hi ${me.name} · hosted by ${m.hostName}`} onBack={backToEdit} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h1 className="display h1">When works for you?</h1><p className="small" style={{ fontSize: 14 }}>Tick every one you can make.</p></div><Chip>{sel.length} picked</Chip></div>
          <div className="stack">{m.dates.map((d: M) => { const [day, time] = when(d.startsAt, tz).split(', '); return <Pick key={d.id} on={sel.includes(d.id)} onClick={() => setList(sel.includes(d.id) ? sel.filter((x) => x !== d.id) : [...sel, d.id])} title={day} meta={time} />; })}</div>
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}><Btn busy={busy} disabled={sel.length === 0} onClick={async () => (await call('/dates', { ids: sel })) && (setList([]), done())}>{editing ? 'Save' : 'Next'}</Btn><Btn kind="second" onClick={async () => (await call('/dates', { ids: [], none: true })) && (setList([]), done())}>None of these work</Btn></div>
        </main>
      </>
    );
  }

  if (screen === 'none' || screen === 'cant') {
    const none = screen === 'none';
    return (
      <>
        <Header title={m.name} sub={`${me.name} · ${none ? 'no date works' : "can't go"}`} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 16 }}>
          <span style={{ alignSelf: 'center' }}><Mascot size={96} bob /></span>
          <div className="stack"><h1 className="display h1">{none ? 'None of these work' : 'Maybe next time'}</h1><p className="small" style={{ fontSize: 15 }}>{none ? `${m.hostName} will see that. If the date changes, reply here.` : `${m.hostName} knows. You can change your reply here.`}</p></div>
          <Btn kind="second" className="push" onClick={() => setView('code')}>{none ? 'Pick dates after all' : 'Change my reply'}</Btn>
        </main>
      </>
    );
  }

  if (screen === 'rsvp') {
    const options: Array<[string, string, string]> = [['going', 'Going', ''], ['maybe', 'Maybe', locked ? '' : 'You can still vote'], ['no', "Can't go", '']];
    const sel = pickId || (me.rsvp !== 'none' ? me.rsvp : '');
    return (
      <>
        <Header title={m.name} sub={editing ? me.name : `Hi ${me.name}`} onBack={backToEdit} />
        <main className="screen" style={{ padding: '6px 20px 24px' }}>
          <div className="card row" style={{ padding: 16, borderRadius: 20, gap: 14 }}><Mascot size={64} bob /><div className="stack" style={{ gap: 2 }}><span className="display h1">{m.name}</span><span style={{ fontSize: 14, fontWeight: 700 }}>{sched}</span><span className="small" style={{ fontSize: 14 }}>{m.winner ? `${m.winner.name} won the food vote · ` : ''}hosted by {m.hostName}</span></div></div>
          {m.dateChange && !editing && <Note>{m.hostName} moved the date{m.dateChange.replies === 'cleared' ? ' and asked everyone to reply again.' : '. Your reply still stands.'}</Note>}
          {me.rsvpIsDefault && !editing && <Note ok>You picked this date, so you're down as going.</Note>}
          {m.dateMode === 'vote' && me.pickedSetDate === false && me.rsvp === 'none' && !me.joinedLate && <Note>This wasn't one of your dates.</Note>}
          {me.joinedLate && me.rsvp === 'none' && <Note>The date is already set.</Note>}
          {locked && <Note ok>The plan is set. Only your reply can change.</Note>}
          <h1 className="display h1">{editing ? 'Change your reply' : 'Are you coming?'}</h1>
          <div className="stack" role="radiogroup" aria-label="RSVP">{options.map(([v, t, meta]) => <Pick key={v} radio on={sel === v} onClick={() => setPickId(v)} title={t} meta={meta} />)}</div>
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={!sel} onClick={async () => { if (await call('/rsvp', { rsvp: sel })) { setConfirmedReply(true); setPickId(''); done(); } }}>{editing ? 'Save' : 'Continue'}</Btn>
        </main>
      </>
    );
  }

  if (screen === 'location') {
    return (
      <>
        <Header title={m.name} sub={me.name} onBack={backToEdit} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <div className="mapbox" style={{ margin: 0, borderRadius: 20, flex: 'none', height: 200 }}><CrewMap label="Map with your position" /></div>
          <h1 className="display h1">Where are you starting from?</h1>
          {typing ? (
            <>
              <StartPicker saving={busy} search={async (q) => (await api('POST', `/g/${token}/start-search`, { q })).results} onPick={(at) => run(async () => { setM((await api('POST', `/g/${token}/location`, at)).meetup); setTyping(false); done(); })} />
              <Oops>{error}</Oops>
              <Btn kind="text" className="push" onClick={() => { clear(); setTyping(false); }}>Use my location instead</Btn>
            </>
          ) : (
            <>
              <p className="small" style={{ fontSize: 14 }}>Only used to find the middle. Nobody sees it, and it's deleted after the meetup.</p>
              <Oops>{error}</Oops>
              <div className="push stack" style={{ gap: 10 }}>
                <Btn busy={busy} onClick={() => run(async () => { setM((await api('POST', `/g/${token}/location`, await locate())).meetup); done(); })}>Share my location</Btn>
                <Btn kind="text" onClick={() => { clear(); setTyping(true); }}>Type a place instead</Btn>
              </div>
            </>
          )}
        </main>
      </>
    );
  }

  if (screen === 'categories') {
    const sel = list.length || editing ? list : (me.categories as string[]);
    return (
      <>
        <Header title={m.name} sub={hosted} onBack={backToEdit} step={1} />
        <main className="screen" style={{ gap: 10 }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h1 className="display h1">Pick up to {m.maxVotes}</h1><p className="small" style={{ fontSize: 14 }}>Pick what you'd happily eat.</p></div><Chip>{sel.length} of {m.maxVotes}</Chip></div>
          <div className="stack">{m.ballot.map((b: M) => <Pick key={b.key} on={sel.includes(b.key)} onClick={() => setList(sel.includes(b.key) ? sel.filter((x) => x !== b.key) : sel.length < m.maxVotes ? [...sel, b.key] : sel)} lead={<Icon name={b.icon} size={30} />} title={b.name} meta={b.own ? `Added by ${m.hostName}` : undefined} />)}</div>
          <AdSlot placement="guest_vote" show={m.ads} />
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={sel.length === 0} onClick={async () => (await call('/categories', { keys: sel })) && (setList([]), done())}>{editing ? 'Save' : 'Vote'}</Btn>
        </main>
      </>
    );
  }

  if (screen === 'place') {
    const sel = pickId || me.place || '';
    return (
      <>
        <Header title={m.name} sub={me.name} onBack={backToEdit} step={3} />
        <main className="screen">
          <h1 className="display h1">Pick a place</h1>
          <div className="stack" role="radiogroup" aria-label="Place">{m.places.map((p: M) => <Pick key={p.id} radio on={sel === p.id} onClick={() => setPickId(p.id)} title={p.name} meta={`${p.rating ? `★ ${p.rating} · ` : ''}${p.myMinutes ? `${p.myMinutes} min away` : (p.address ?? '')}`} />)}</div>
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={!sel} onClick={async () => (await call('/place', { id: sel })) && (setPickId(''), done())}>{editing ? 'Save' : 'Vote'}</Btn>
        </main>
      </>
    );
  }

  if (screen === 'info') {
    const place = m.places[0];
    return (
      <>
        <Header title={m.name} sub={sched} step={4} />
        <main className="screen">
          <div className="mapbox"><CrewMap label={`Map with ${place?.name}`} target={place ? { lat: place.lat, lng: place.lng } : null} /></div>
          <div className="sheet">
            {m.dateChange && <Note>New date: {sched}.</Note>}
            <div className="row" style={{ gap: 12 }}><Mascot size={64} bob /><div className="stack" style={{ gap: 2 }}><h1 className="display h1">{place?.name}</h1><span style={{ fontSize: 15, fontWeight: 600 }}>{[m.winner?.name, place?.address].filter(Boolean).join(' · ')}</span></div></div>
            <div className="grid3">{[[sched.split(', ')[1], 'start'], [place?.myMinutes ? `${place.myMinutes} min` : '—', 'away'], [m.progress.going, 'going']].map(([v, l], i) => <div key={l} className="card rise" style={{ padding: 10, borderRadius: 14, background: i === 1 ? 'var(--accent)' : undefined, color: i === 1 ? 'var(--ink)' : undefined }}><div className="display h2">{v}</div><div style={{ fontSize: 12 }}>{l}</div></div>)}</div>
            {place?.directions && <a className="btn" href={place.directions} target="_blank" rel="noopener noreferrer">Directions</a>}
            <Updates token={token} m={m} setM={setM} />
            <div className="row between"><button className="btn text" style={{ width: 'auto' }} onClick={() => setView(me.canAmend ? 'rsvp' : 'code')}>Change my reply</button><Link to="/sign-in" className="btn text" style={{ width: 'auto' }}>Host your own</Link></div>
          </div>
        </main>
      </>
    );
  }

  // ----- waiting for the host: what is settled, what is not, and your own choices -----
  const stage = !m.dateIsSet ? 1 : m.status === 'place_vote' ? 3 : 2;
  const chip = (set: boolean) => <Chip kind={set ? undefined : 'plain'}>{set ? 'Set' : 'Voting'}</Chip>;
  return (
    <>
      <Header title={m.name} sub={hosted} step={stage} />
      <main className="screen">
        <div className="row" style={{ gap: 14 }}><Mascot size={64} bob /><div className="stack" style={{ gap: 2 }}><h1 className="display h1">You've voted</h1><p className="small" style={{ fontSize: 14 }}>{stage === 3 ? `Waiting for ${m.hostName} to lock in the place.` : stage === 1 ? `Waiting for ${m.hostName} to set the date.` : `Waiting for ${m.hostName} to pick the place.`}</p></div></div>
        <Facts rows={[
          ['When', m.dateIsSet ? sched : `${m.progress.dateAnswered} of ${m.progress.total} answered`, chip(m.dateIsSet)],
          ['Food', m.winner ? m.winner.name : `${m.progress.categoryVoted} of ${m.progress.total} voted`, chip(!!m.winner)],
          ['Place', m.status === 'place_vote' ? `${m.progress.placeVoted} of ${m.progress.total} voted` : 'Not yet', m.status === 'place_vote' ? chip(false) : undefined],
        ]} />
        <Facts title="Your choices" rows={[...(m.dateIsSet ? [['Reply', reply] as [string, ReactNode]] : []), ...(m.dateMode === 'vote' && myDates ? [['Dates', myDates] as [string, ReactNode]] : []), ['Food', myCats || '—'], ...(myPlace ? [['Place', myPlace] as [string, ReactNode]] : [['Start', me.hasLocation ? 'Shared' : 'Not shared'] as [string, ReactNode]])]} />
        <div className="push stack"><Updates token={token} m={m} setM={setM} /><Btn kind="second" onClick={() => setView(me.canAmend ? 'edit' : 'code')}>Change my answers</Btn></div>
      </main>
    </>
  );
}

function Redirect({ to }: { to: () => void }) {
  useEffect(to, [to]);
  return <Loading />;
}
