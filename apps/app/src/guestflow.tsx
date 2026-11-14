import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { LIMITS } from '@zorion/core';
import { MeetupMap } from './meetupmap';
import { Credits } from './sources';
import { StartCard } from './start';
import { Updates } from './updates';
import { ApiError, Link, api, useAction, when } from './lib';
import { Actions, Btn, Chevron, Chip, Codes, Facts, Field, Header, Icon, Loading, Mascot, Note, Oops, Pick, Pig, AdSlot, Switch, Toast, copyText, guestSteps } from './ui';

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

/** Where a guest is: Reply, (Date), Food, Place, Confirmed. */
export function guestStep(m: M): { names: string[]; current: number } {
  const names = guestSteps(m.dateMode === 'vote');
  const me = m.me as M | null;
  const at = !me || me.rsvp === 'none' ? 'Reply' : ({ date_vote: 'Date', voting: 'Food', places: 'Place', place_vote: 'Place', confirmed: 'Confirmed' } as Record<string, string>)[m.status] ?? 'Reply';
  return { names, current: Math.max(0, names.indexOf(at)) };
}

/** The desktop's second column for guests: the crew map, the host, and the plan at a glance. */
export function GuestPane({ m, token }: { m: M; token: string }) {
  const place = m.status === 'confirmed' ? m.places[0] : null;
  const known = m.people.filter((p: M) => p.claimed).length;
  return (
    <>
      {m.me && <MeetupMap source={`/g/${token}/map`} version={`${m.status}:${m.progress.total}:${m.me.hasLocation}:${m.me.showOnMap}:${known}`} height={340} />}
      <div className="card row" style={{ padding: 14, gap: 12 }}><Pig avatar={m.hostAvatar} size={48} label={`${m.hostName}, host`} /><span className="stack" style={{ gap: 0 }}><strong>{m.hostName}</strong><span className="small">Host</span></span></div>
      <div className="card glance-card"><div className="display h2" style={{ padding: '6px 2px' }}>At a glance</div><Facts rows={[['When', when(m.startsAt, m.timeZone)], ['Food', m.winner?.name ?? 'Being voted'], ['Place', place?.name ?? (m.status === 'place_vote' ? 'Being voted' : 'Not yet')], ['Coming', `${m.progress.going} going`]]} /></div>
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
  const [trail, setTrail] = useState<View[]>([]);
  const [returnTo, setReturnTo] = useState<'edit' | 'auto'>('edit');
  const setView = (v: View) => { clear(); setCode(''); setViewRaw(v); };
  const call = (path: string, body?: unknown) => run(async () => setM((await api('POST', `/g/${token}${path}`, body)).meetup));
  const me = m.me as M | null;
  const tz = m.timeZone;
  const sched = when(m.startsAt, tz);
  const hosted = `${m.dateIsSet ? sched : 'Date being voted'} · hosted by ${m.hostName}`;
  const editing = view !== 'auto' && view !== 'code';
  // Once the plan is confirmed only the reply can change, so there is no choices menu to go back to.
  const locked = m.status === 'confirmed';
  const backToEdit = editing && view !== 'edit' ? () => setView(locked || returnTo === 'auto' ? 'auto' : 'edit') : undefined;
  const done = () => { setView(editing && !locked && returnTo === 'edit' ? 'edit' : 'auto'); setReturnTo('edit'); };
  /** Open one answer to change it: straight away while changes are allowed, otherwise after the code. */
  const change = (v: View, back: 'edit' | 'auto' = 'auto') => { setReturnTo(back); setView(me?.canAmend ? v : 'code'); };
  const pig = <Pig avatar={m.hostAvatar} size={36} label={`${m.hostName}, host`} />;
  // ----- the next thing this guest still has to do -----
  const need: string = !me ? 'join' : (m.dateMode === 'vote' && !m.dateIsSet)
    ? (me.dates.length === 0 && !me.noDateWorks ? 'dates' : me.noDateWorks ? 'none' : !me.hasLocation ? 'location' : me.categories.length === 0 && m.maxVotes > 0 ? 'categories' : 'wait')
    : me.rsvp === 'none' || (me.rsvpIsDefault && !confirmedReply) ? 'rsvp'
      : me.rsvp === 'no' ? 'cant'
        : !me.hasLocation && m.status !== 'confirmed' ? 'location'
          : m.status === 'voting' && me.categories.length === 0 && m.maxVotes > 0 ? 'categories'
            : m.status === 'place_vote' && !me.place ? 'place'
              : m.status === 'confirmed' ? 'info' : 'wait';
  useEffect(() => {
    if (editing || ['join', 'wait', 'info'].includes(need)) return;
    setTrail((t) => (t[t.length - 1] === need ? t : [...t.filter((x) => x !== need), need as View]));
  }, [need, editing]);

  // ----- not known on this device yet -----
  if (!me) {
    if (view === 'code') {
      return (
        <main className="screen" style={{ padding: '20px 20px 24px', gap: 14 }}>
          <div className="row" style={{ gap: 14 }}><Pig avatar={m.hostAvatar} size={72} label={`${m.hostName}, host`} /><div className="stack" style={{ gap: 2 }}><span className="small" style={{ fontWeight: 600, fontSize: 14 }}>Welcome back</span><span className="display h0">{m.name}</span></div></div>
          <div className="stack"><h1 className="display h1">Enter your code</h1><p className="small" style={{ fontSize: 15 }}>The 4 characters you got when you joined.</p></div>
          <Codes big length={LIMITS.guestCodeLength} digits={false} value={code} onChange={setCode} label="Your 4-character code" />
          <Oops>{error}</Oops>
          <p className="small" style={{ fontSize: 14 }}>Lost it? {m.hostName} can reset it.</p>
          <Actions><Btn busy={busy} disabled={code.length !== LIMITS.guestCodeLength} onClick={async () => (await call('/code', { code })) && setView('auto')}>Continue</Btn><Btn kind="second" onClick={() => setView('auto')}>I'm new</Btn></Actions>
        </main>
      );
    }
    const free = m.people.filter((p: M) => !p.claimed);
    return (
      <main className="screen" style={{ padding: '20px 20px 24px', gap: 10 }}>
        <div className="row rise" style={{ gap: 14, paddingBottom: 6 }}><Pig avatar={m.hostAvatar} size={72} label={`${m.hostName}, host`} /><div className="stack" style={{ gap: 2 }}><span className="small" style={{ fontWeight: 600, fontSize: 14 }}>{m.hostName} invited you to</span><span className="display h0">{m.name}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{m.dateIsSet ? sched : 'Date to be voted'}</span></div></div>
        <h1 className="display h1">Who are you?</h1>
        <div className="stack" role="radiogroup" aria-label="Your name">
          {m.people.map((p: M) => (p.claimed ? <div key={p.id} className="pick taken"><span className="grow wrap" style={{ fontWeight: 700 }}>{p.name}</span><span className="small">Joined</span></div> : <Pick key={p.id} radio on={pickId === p.id} onClick={() => { setPickId(p.id); setName(''); }} title={p.name} />))}
        </div>
        {m.status !== 'confirmed' && <Field label="Not listed? Add your name" value={name} max={LIMITS.inviteeName} placeholder="Your name" onChange={(v) => { setName(v); setPickId(''); }} />}
        <Oops>{error}</Oops>
        <Actions>
          <Btn busy={busy} disabled={!pickId && !name.trim()} onClick={() => run(async () => { const r = await api('POST', `/g/${token}/join`, pickId ? { participantId: pickId } : { name }); setNewCode(r.code); setPickId(''); setM(r.meetup); })}>{pickId ? `I'm ${free.find((p: M) => p.id === pickId)?.name}` : name.trim() ? `Join as ${name.trim()}` : 'Pick your name'}</Btn>
          <Btn kind="second" onClick={() => setView('code')}>I have a code</Btn>
        </Actions>
        <p className="small center"><a href="/sign-in">Sign in</a> · <a href="/api/legal/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/api/legal/terms" target="_blank" rel="noopener">Terms</a></p>
      </main>
    );
  }

  // ----- the code, shown once right after joining -----
  if (newCode) {
    return (
      <>
        <Header title={m.name} sub={me.name} right={pig} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 16 }}>
          <span style={{ alignSelf: 'center' }}><Mascot size={88} bob /></span>
          <div className="stack"><h1 className="display h1">Keep this code</h1><p className="small" style={{ fontSize: 15 }}>For changes later, or another device.</p></div>
          <Codes big readOnly length={LIMITS.guestCodeLength} digits={false} value={newCode} label="Your code" />
          <Actions><Btn onClick={() => setNewCode(null)}>Continue</Btn><Btn kind="second" onClick={async () => setToast((await copyText(newCode)) ? 'Code copied' : newCode)}>Copy code</Btn></Actions>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- enter the code to change something -----
  if (view === 'code') {
    return (
      <>
        <Header title={m.name} sub={me.name} onBack={() => setView('auto')} right={pig} />
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <h1 className="display h1">Enter your code</h1>
          <Codes big length={LIMITS.guestCodeLength} digits={false} value={code} onChange={setCode} label="Your 4-character code" />
          <Oops>{error}</Oops>
          <p className="small" style={{ fontSize: 14 }}>Lost it? {m.hostName} can reset it.</p>
          <Actions><Btn busy={busy} disabled={code.length !== LIMITS.guestCodeLength} onClick={async () => (await call('/code', { code })) && setView(m.status === 'confirmed' ? 'rsvp' : 'edit')}>Continue</Btn></Actions>
        </main>
      </>
    );
  }

  const myCats = (me.categories as string[]).map((k) => m.ballot.find((b: M) => b.key === k)?.name ?? k).join(', ');
  const myDates = (me.dates as string[]).map((id) => when(m.dates.find((d: M) => d.id === id)?.startsAt ?? null, tz).split(',')[0]).join(', ');
  const myPlace = m.places.find((p: M) => p.id === me.place)?.name;
  const reply = me.rsvp === 'none' ? 'No reply yet' : me.rsvp === 'no' ? "Can't go" : me.rsvp[0].toUpperCase() + me.rsvp.slice(1);

  // ----- your choices: every answer, with Change while its vote is open -----
  const choiceRows = (back: 'edit' | 'auto') => {
    const open = (v: View) => <button className="btn second sm" onClick={() => (view === 'edit' ? setView(v) : change(v, back))}>Change</button>;
    const shut = (t: string) => <span className="small" style={{ fontWeight: 600 }}>{t}</span>;
    const rows: Array<[string, ReactNode, ReactNode]> = [];
    if (m.dateIsSet) rows.push(['Reply', reply, open('rsvp')]);
    if (m.dateMode === 'vote') rows.push(['Dates', myDates || 'None', m.status === 'date_vote' ? open('dates') : shut('Closed')]);
    if (!locked) rows.push(['Start', me.hasLocation ? (me.startLabel ?? 'Shared') : 'Not shared', open('location')]);
    if (m.maxVotes > 0) rows.push(['Food', myCats || 'None yet', ['date_vote', 'voting'].includes(m.status) ? open('categories') : shut(locked ? 'Final' : 'Closed')]);
    rows.push(['Place', myPlace ?? (m.status === 'place_vote' ? 'Not voted' : locked ? (m.places[0]?.name ?? '—') : 'After the food vote'), m.status === 'place_vote' ? open('place') : shut(locked ? 'Final' : 'Not open')]);
    return (
      <div className="list stagger">
        {rows.map(([k, v, action]) => <div key={k} className="li"><span className="stack" style={{ gap: 0 }}><span className="small">{k}</span><strong>{v}</strong></span>{action}</div>)}
        {me.hasLocation && <div className="li"><span className="stack" style={{ gap: 0 }}><span className="small">On the crew map</span><strong>{me.showOnMap ? 'Your pin and name' : 'Rough area'}</strong></span><button className="btn second sm" onClick={() => call('/map-visibility', { show: !me.showOnMap })}>{me.showOnMap ? 'Hide' : 'Show'}</button></div>}
      </div>
    );
  };
  if (view === 'edit') {
    if (!me.canAmend) return <Redirect to={() => setView('code')} />;
    if (locked) return <Redirect to={() => setView('rsvp')} />;
    return (
      <>
        <Header title={m.name} sub={me.name} onBack={() => setView('auto')} right={pig} />
        <main className="screen">
          <h1 className="display h1">Your choices</h1>
          <p className="small" style={{ fontSize: 14 }}>Change any vote that's still open.</p>
          {choiceRows('edit')}
          <Oops>{error}</Oops>
          <Actions><Btn kind="second" onClick={() => setView('auto')}>Done</Btn></Actions>
        </main>
      </>
    );
  }

  const screen = editing ? (locked && view !== 'rsvp' ? 'rsvp' : view) : need;
  // Back on every step, also the first time through: to the screen before this one.
  const prev = trail[trail.indexOf(need as View) - 1];
  const back = editing ? backToEdit : prev && ['dates', 'rsvp', 'location', 'categories', 'place'].includes(screen) ? () => change(prev) : undefined;
  const head = (sub: ReactNode) => <Header title={m.name} sub={sub} onBack={back} right={pig} steps={guestStep(m)} />;

  if (screen === 'dates') {
    const sel = list.length || editing ? list : (me.dates as string[]);
    return (
      <>
        {head(`Hi ${me.name}`)}
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h1 className="display h1">When works for you?</h1><p className="small" style={{ fontSize: 14 }}>Tick every one you can make.</p></div><Chip>{sel.length} picked</Chip></div>
          <div className="stack">{m.dates.map((d: M) => { const [day, time] = when(d.startsAt, tz).split(', '); return <Pick key={d.id} on={sel.includes(d.id)} onClick={() => setList(sel.includes(d.id) ? sel.filter((x) => x !== d.id) : [...sel, d.id])} title={day} meta={time} />; })}</div>
          <Oops>{error}</Oops>
          <Actions><Btn busy={busy} disabled={sel.length === 0} onClick={async () => (await call('/dates', { ids: sel })) && (setList([]), done())}>{editing ? 'Save' : 'Next'}</Btn><Btn kind="second" onClick={async () => (await call('/dates', { ids: [], none: true })) && (setList([]), done())}>None work</Btn></Actions>
        </main>
      </>
    );
  }

  if (screen === 'none' || screen === 'cant') {
    const none = screen === 'none';
    return (
      <>
        {head(me.name)}
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 16 }}>
          <span style={{ alignSelf: 'center' }}><Mascot size={96} bob /></span>
          <div className="stack"><h1 className="display h1">{none ? 'None of these work' : 'Maybe next time'}</h1><p className="small" style={{ fontSize: 15 }}>{m.hostName} can see that.</p></div>
          <Actions><Btn kind="second" onClick={() => change(none ? 'dates' : 'rsvp')}>{none ? 'Pick dates' : 'Change reply'}</Btn></Actions>
        </main>
      </>
    );
  }

  if (screen === 'rsvp') {
    const options: Array<[string, string, string]> = [['going', 'Going', ''], ['maybe', 'Maybe', locked ? '' : 'You can still vote'], ['no', "Can't go", '']];
    const sel = pickId || (me.rsvp !== 'none' ? me.rsvp : '');
    return (
      <>
        {head(editing ? me.name : `Hi ${me.name}`)}
        <main className="screen" style={{ padding: '6px 20px 24px' }}>
          <div className="card row rise" style={{ padding: 16, borderRadius: 20, gap: 14 }}><Pig avatar={m.hostAvatar} size={56} /><div className="stack" style={{ gap: 2 }}><span className="display h1">{m.name}</span><span className="small" style={{ fontSize: 14 }}>{m.hostName} hosts · {sched}{m.winner ? ` · ${m.winner.name}` : ''}</span></div></div>
          {m.dateChange && !editing && <Note>{m.hostName} moved the date{m.dateChange.replies === 'cleared' ? ' and asked everyone to reply again.' : '. Your reply still stands.'}</Note>}
          {me.rsvpIsDefault && !editing && <Note ok>You picked this date, so you're down as going.</Note>}
          {m.dateMode === 'vote' && me.pickedSetDate === false && me.rsvp === 'none' && !me.joinedLate && <Note>This wasn't one of your dates.</Note>}
          {me.joinedLate && me.rsvp === 'none' && <Note>The date is already set.</Note>}
          {locked && <Note ok>The plan is set. Only your reply can change.</Note>}
          <h1 className="display h1">{editing ? 'Change your reply' : 'Are you coming?'}</h1>
          <div className="stack" role="radiogroup" aria-label="RSVP">{options.map(([v, t, meta], i) => <Pick key={v} delay={80 + i * 45} radio on={sel === v} onClick={() => setPickId(v)} title={t} meta={meta} />)}</div>
          <Oops>{error}</Oops>
          <Actions><Btn busy={busy} disabled={!sel} onClick={async () => { if (await call('/rsvp', { rsvp: sel })) { setConfirmedReply(true); setPickId(''); done(); } }}>{editing ? 'Save' : 'Continue'}</Btn></Actions>
        </main>
      </>
    );
  }

  if (screen === 'location') {
    return (
      <>
        {head(me.name)}
        <main className="screen" style={{ padding: '6px 20px 24px', gap: 14 }}>
          <h1 className="display h1">Where are you starting from?</h1>
          <p className="small" style={{ fontSize: 14 }}>Used to find places fair to everyone. Deleted after the meetup.</p>
          <StartCard titled={false} isSet={!!me.hasLocation} label={me.startLabel ?? null} search={async (q) => (await api('POST', `/g/${token}/start-search`, { q }))} save={async (at) => { setM((await api('POST', `/g/${token}/location`, at)).meetup); done(); }} />
          <div className="only-phone"><MeetupMap source={`/g/${token}/map`} version={`start:${m.progress.total}:${me.showOnMap}`} height={200} compact /></div>
          <Switch on={!!me.showOnMap} onChange={(show) => call('/map-visibility', { show })} title="Show me on the crew map" meta={me.showOnMap ? 'Others see your pin and name' : 'Off: a rough area, no name'} />
          {me.hasLocation && <Actions><Btn onClick={() => done()}>Continue</Btn></Actions>}
        </main>
      </>
    );
  }

  if (screen === 'categories') {
    const sel = list.length || editing ? list : (me.categories as string[]);
    return (
      <>
        {head(hosted)}
        <main className="screen" style={{ gap: 10 }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h1 className="display h1">Pick up to {m.maxVotes}</h1><p className="small" style={{ fontSize: 14 }}>What would you happily eat?</p></div><Chip>{sel.length} of {m.maxVotes}</Chip></div>
          <div className="stack">{m.ballot.map((b: M, i: number) => <Pick key={b.key} delay={60 + i * 45} on={sel.includes(b.key)} onClick={() => setList(sel.includes(b.key) ? sel.filter((x) => x !== b.key) : sel.length < m.maxVotes ? [...sel, b.key] : sel)} lead={<Icon name={b.icon} size={30} />} title={b.name} meta={b.own ? `Added by ${m.hostName}` : undefined} />)}</div>
          <AdSlot placement="guest_vote" show={m.ads} />
          <Oops>{error}</Oops>
          <Actions><Btn busy={busy} disabled={sel.length === 0} onClick={async () => (await call('/categories', { keys: sel })) && (setList([]), done())}>{editing ? 'Save' : 'Vote'}</Btn></Actions>
        </main>
      </>
    );
  }

  if (screen === 'place') {
    const sel = pickId || me.place || '';
    return (
      <>
        {head(me.name)}
        <main className="screen">
          <h1 className="display h1">Pick a place</h1>
          <div className="only-phone"><MeetupMap source={`/g/${token}/map`} version={`vote:${m.places.length}`} height={230} compact /></div>
          <div className="stack" role="radiogroup" aria-label="Place">{m.places.map((p: M, i: number) => <Pick key={p.id} delay={60 + i * 45} lead={<span className="numdot">{i + 1}</span>} radio on={sel === p.id} onClick={() => setPickId(p.id)} title={p.name} meta={`${p.rating ? `★ ${p.rating} · ` : ''}${p.myMinutes ? `${p.myMinutes} min from you` : (p.address ?? '')}`} />)}</div>
          <Credits places={m.places} times={m.places.some((p: M) => p.myMinutes)} />
          <Oops>{error}</Oops>
          <Actions><Btn busy={busy} disabled={!sel} onClick={async () => (await call('/place', { id: sel })) && (setPickId(''), done())}>{editing ? 'Save' : 'Vote'}</Btn></Actions>
        </main>
      </>
    );
  }

  if (screen === 'info') {
    const place = m.places[0];
    return (
      <>
        {head(sched)}
        <main className="screen">
          {m.dateChange && <Note>New date: {sched}.</Note>}
          <div className="row rise" style={{ gap: 12 }}><Mascot size={56} bob /><div className="stack" style={{ gap: 2 }}><h1 className="display h1">It's on</h1><span style={{ fontSize: 15, fontWeight: 600 }}>{place?.name}{place?.myMinutes ? ` · ${place.myMinutes} min from you` : ''}</span></div></div>
          <div className="only-phone"><MeetupMap source={`/g/${token}/map`} version={`confirmed:${place?.id}`} height={230} compact /></div>
          {place?.directions && <a className="btn" href={place.directions} target="_blank" rel="noopener noreferrer">Directions</a>}
          {choiceRows('auto')}
          <Updates token={token} m={m} setM={setM} />
          <p className="small center"><Link to="/sign-in">Host your own meetup</Link></p>
        </main>
      </>
    );
  }

  // ----- waiting for the host: the crew map and your own choices -----
  const waitingFor = !m.dateIsSet ? 'set the date' : m.status === 'place_vote' ? 'lock in the place' : 'pick places';
  return (
    <>
      {head(hosted)}
      <main className="screen">
        <div className="row rise" style={{ gap: 12 }}><Mascot size={48} bob /><div className="stack" style={{ gap: 2 }}><h1 className="display h1">You've voted</h1><p className="small" style={{ fontSize: 14 }}>Waiting for {m.hostName} to {waitingFor}.</p></div></div>
        <div className="only-phone"><MeetupMap source={`/g/${token}/map`} version={`wait:${m.status}:${m.progress.total}:${me.showOnMap}`} height={190} compact /></div>
        {choiceRows('auto')}
        <Oops>{error}</Oops>
        <AdSlot placement="guest_vote" show={m.ads} />
        <Actions><Updates token={token} m={m} setM={setM} /></Actions>
      </main>
    </>
  );
}

function Redirect({ to }: { to: () => void }) {
  useEffect(to, [to]);
  return <Loading />;
}
