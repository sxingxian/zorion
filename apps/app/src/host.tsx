import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { LIMITS, OWN_ICONS, halfRoundedUp } from '@zorion/core';
import { CrewMap, ring } from './map';
import { StartPicker } from './start';
import { ApiError, Link, type Me, api, deviceZone, fromLocalInput, navigate, toLocalInput, useAction, when } from './lib';
import { Btn, Check, Chevron, Chip, Facts, Field, Header, Icon, Loading, Mascot, Note, Oops, Person, Pick, Plus, Remove, Seg, Sponsored, Switch, Tally, Toast, copyText, locate } from './ui';

type M = Record<string, any>;
const STATUS: Record<string, string> = { draft: 'Setting up', date_vote: 'Date vote', voting: 'Voting', places: 'Picking places', place_vote: 'Place vote', confirmed: 'Confirmed', ended: 'Done' };

// ---------- home ----------
export function Home({ me }: { me: Me }) {
  const [list, setList] = useState<M[] | null>(null);
  useEffect(() => { api('GET', '/meetups').then((r) => setList(r.meetups)).catch(() => setList([])); }, []);
  return (
    <>
      <header className="head"><div className="head-row between"><span className="row"><Mascot size={38} /><span className="wordmark">Zorion</span></span>{me.plan === 'pro' ? <Chip kind="pro">Pro</Chip> : <Link to="/pro" className="chip plain" style={{ padding: '13px 12px', fontSize: 13, textDecoration: 'none' }}>Free · Go Pro</Link>}</div></header>
      <main className="screen" style={{ gap: 14 }}>
        <h1 className="display h0">Your meetups</h1>
        {!list ? <Loading /> : list.length === 0 ? <Note>No meetups yet.</Note> : list.map((m, i) => (
          <Link key={m.id} to={`/m/${m.id}`} className="card rise" style={{ padding: 16, borderRadius: 20, textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 8, animationDelay: `${i * 0.06}s` }}>
            <span className="row between" style={{ alignItems: 'flex-start' }}><span className="display h1">{m.name}</span><Chip kind={m.status === 'confirmed' ? 'sel' : m.status === 'ended' ? 'plain' : undefined}>{STATUS[m.status]}</Chip></span>
            <span className="small" style={{ fontSize: 14 }}>{when(m.startsAt, m.timeZone)} · {m.going} of {m.people} going</span>
          </Link>
        ))}
        <Sponsored placement="host_home" show={me.plan !== 'pro'} />
        <Btn to="/new" className="push"><Plus />New meetup</Btn>
      </main>
    </>
  );
}

// ---------- new meetup ----------
interface Own { name: string; icon: string; save: boolean; off?: boolean }
export function Create({ me }: { me: Me }) {
  const pro = me.plan === 'pro';
  const [step, setStep] = useState<'details' | 'dates' | 'own' | 'people'>('details');
  const [name, setName] = useState('');
  const [dateVote, setDateVote] = useState(false);
  const [start, setStart] = useState(() => { const d = new Date(); d.setHours(20, 0, 0, 0); return toLocalInput(d); });
  const [options, setOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [cats, setCats] = useState<M[]>([]);
  const [ownAllowed, setOwnAllowed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState<Own[]>([]);
  const [ownDraft, setOwnDraft] = useState<Own>({ name: '', icon: 'hotpot', save: true });
  const [mode, setMode] = useState<'walk' | 'transit' | 'cycle'>('walk');
  const [people, setPeople] = useState<string[]>([]);
  const [person, setPerson] = useState('');
  const [run, busy, error] = useAction();

  useEffect(() => {
    api('GET', '/categories').then((r) => {
      setCats(r.categories);
      setOwnAllowed(r.ownAllowed);
      setPicked(r.categories.slice(0, 5).map((c: M) => c.key));
      setOwn(r.own.map((o: M) => ({ name: o.name, icon: o.icon, save: true, off: true })));
    }).catch(() => {});
  }, []);
  const ownOn = own.filter((o) => !o.off);
  const total = picked.length + ownOn.length;
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : total < LIMITS.ballotMax ? [...p, key] : p));
  const submit = () => run(async () => {
    const r = await api('POST', '/meetups', {
      name, timeZone: deviceZone(), startsAt: dateVote ? null : fromLocalInput(start), dateOptions: dateVote ? options.map((o) => fromLocalInput(o)) : [],
      ballot: [...picked.map((key) => ({ key })), ...ownOn.map((o) => ({ own: { name: o.name, icon: o.icon, save: o.save } }))], travelMode: mode, invitees: people,
    });
    navigate(`/m/${r.meetup.id}`, true);
  });

  if (step === 'dates') {
    return (
      <>
        <Header title="When could it be?" sub={name || 'New meetup'} onBack={() => setStep('details')} />
        <main className="screen">
          <div className="row between" style={{ alignItems: 'flex-start' }}><p className="small" style={{ fontSize: 14 }}>Guests tick the ones they can make.</p><Chip>{options.length} of {LIMITS.dateOptionsMax}</Chip></div>
          <div className="stack">{options.map((o) => <div key={o} className="pick rise"><span className="grow"><strong>{when(fromLocalInput(o), deviceZone())}</strong></span><Remove label="Remove this date" onClick={() => setOptions(options.filter((x) => x !== o))} /></div>)}</div>
          <Field label="Date and time" type="datetime-local" value={draft} onChange={setDraft} />
          <Btn kind="second" disabled={!draft || options.includes(draft) || options.length >= LIMITS.dateOptionsMax} onClick={() => { setOptions([...options, draft].sort()); setDraft(''); }}>Add date</Btn>
          <div className="push stack" style={{ gap: 4 }}>
            <Btn kind="text" onClick={() => { setDateVote(false); setStep('details'); }}>Use one date instead</Btn>
            <Btn disabled={options.length < 2} onClick={() => { setDateVote(true); setStep('details'); }}>Use these {options.length || ''} dates</Btn>
          </div>
        </main>
      </>
    );
  }
  if (step === 'own') {
    const ok = ownDraft.name.trim().length > 0;
    return (
      <>
        <Header title="Your own category" sub={name || 'New meetup'} onBack={() => setStep('details')} />
        <main className="screen">
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div className="tile pop" aria-pressed="true" style={{ flex: 'none', width: 108 }}><Icon name={ownDraft.icon} /><span className="stack" style={{ gap: 0 }}><b>{ownDraft.name || 'Name'}</b><span className="small">Preview</span></span></div>
            <div className="grow"><Field label="Name" value={ownDraft.name} max={LIMITS.categoryName} onChange={(v) => setOwnDraft({ ...ownDraft, name: v })} /></div>
          </div>
          <div className="row between"><span className="label">Pick an icon</span></div>
          <div className="grid4">{OWN_ICONS.map((k) => <button key={k} className="tile" style={{ minHeight: 64, alignItems: 'center', justifyContent: 'center' }} aria-pressed={ownDraft.icon === k} aria-label={k} onClick={() => setOwnDraft({ ...ownDraft, icon: k })}><Icon name={k} size={28} /></button>)}</div>
          <p className="small">Places are found by this name.</p>
          <Switch on={ownDraft.save} onChange={(save) => setOwnDraft({ ...ownDraft, save })} title="Save for next time" />
          <Btn className="push" disabled={!ok || total >= LIMITS.ballotMax} onClick={() => { setOwn([...own.filter((o) => o.name.toLowerCase() !== ownDraft.name.trim().toLowerCase()), { ...ownDraft, name: ownDraft.name.trim() }]); setOwnDraft({ name: '', icon: 'hotpot', save: true }); setStep('details'); }}>Add</Btn>
        </main>
      </>
    );
  }
  if (step === 'people') {
    const add = () => { const n = person.trim(); if (n && !people.some((p) => p.toLowerCase() === n.toLowerCase())) setPeople([...people, n]); setPerson(''); };
    return (
      <>
        <Header title="Add your people" sub={name} onBack={() => setStep('details')} />
        <main className="screen">
          <Field label="Name" value={person} max={LIMITS.inviteeName} placeholder="Add a name" onChange={setPerson} />
          <Btn kind="second" disabled={!person.trim()} onClick={add}>Add</Btn>
          <div className="card" style={{ padding: '2px 4px 2px 12px' }}>
            <Person name={me.display_name} tag="you · host" />
            {people.map((p) => <Person key={p} name={p} right={<Remove label={`Remove ${p}`} onClick={() => setPeople(people.filter((x) => x !== p))} />} />)}
          </div>
          <p className="small">Anyone not listed can add themselves from the link.</p>
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} onClick={submit}>Next</Btn>
        </main>
      </>
    );
  }
  const ready = name.trim().length > 0 && total >= 1 && (dateVote ? options.length >= 2 : !!fromLocalInput(start));
  return (
    <>
      <Header title="New meetup" back="/" />
      <main className="screen" style={{ gap: 14 }}>
        <Field label="Meetup name" value={name} max={LIMITS.meetupName} placeholder="Midnight poetry party" onChange={setName} />
        {dateVote ? <Note ok>Voting on {options.length} dates</Note> : <Field label="Date and time" type="datetime-local" value={start} onChange={setStart} />}
        <button className="pick" style={{ minHeight: 44, fontSize: 14, fontWeight: 700 }} onClick={() => setStep('dates')}><span className="grow">{dateVote ? 'Change dates' : 'Let guests vote on the date'}</span><Chevron /></button>
        <div className="stack">
          <div className="row between"><span className="label">Food options</span><Chip>{total} of {LIMITS.ballotMax}</Chip></div>
          <div className="grid3">
            {cats.map((c) => <button key={c.key} className="tile" aria-pressed={picked.includes(c.key)} onClick={() => toggle(c.key)}><Icon name={c.icon} /><b>{c.name}</b></button>)}
            {own.map((o) => <button key={o.name} className="tile" aria-pressed={!o.off} onClick={() => setOwn(own.map((x) => (x.name === o.name ? { ...x, off: x.off ? total >= LIMITS.ballotMax : true } : x)))}><Icon name={o.icon} /><span className="stack" style={{ gap: 0 }}><b>{o.name}</b><span className="small">Yours</span></span></button>)}
          </div>
          {pro && ownAllowed ? <button className="dash" onClick={() => setStep('own')}><Plus />Add your own</button> : <Link to="/pro" className="dash"><Plus />Add your own <Chip kind="pro">Pro</Chip></Link>}
          <p className="small">{total > 1 ? `Each guest picks up to ${halfRoundedUp(total)}.` : 'One option, so no vote.'}</p>
        </div>
        <div className="stack"><span className="label">Getting there</span><Seg value={mode} onChange={setMode} options={[{ value: 'walk', label: 'Walk' }, { value: 'transit', label: 'Transit', locked: !pro }, { value: 'cycle', label: 'Cycle', locked: !pro }]} /></div>
        <Btn className="push" disabled={!ready} onClick={() => setStep('people')}>Next</Btn>
      </main>
    </>
  );
}

// ---------- one meetup, from draft to confirmed ----------
export function useMeetup(id: string) {
  const [m, setM] = useState<M | null>(null);
  const [missing, setMissing] = useState(false);
  const refresh = useCallback(() => api('GET', `/meetups/${id}`).then((r) => setM(r.meetup)).catch((e) => { if (e instanceof ApiError && e.status === 404) setMissing(true); }), [id]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 8000);
    return () => clearInterval(t);
  }, [refresh]);
  return { m, setM, missing, refresh };
}

const catName = (m: M, key: string) => m.ballot.find((b: M) => b.key === key)?.name ?? key;

export function HostPane({ m }: { m: M }) {
  const chosen = m.places.find((p: M) => p.id === m.chosenPlace);
  const hub = chosen ?? m.middle;
  const people = hub ? ring(hub, m.people) : [];
  const facts: Array<[string, ReactNode]> = [
    ['When', when(m.startsAt, m.timeZone)],
    ['Food', m.winner ? catName(m, m.winner) : m.status === 'draft' ? `${m.ballot.length} on the ballot` : 'Being voted'],
    ['Place', chosen ? chosen.name : m.status === 'place_vote' ? 'Being voted' : 'After the vote'],
    ['Coming', `${m.counts.going} going · ${m.counts.maybe} maybe`],
  ];
  return (
    <>
      <CrewMap label="Map of the crew and the fair middle" people={people} middle={m.middle} target={chosen} places={m.places.filter((p: M) => !chosen && (p.shortlisted || m.status === 'places')).map((p: M) => ({ lat: p.lat, lng: p.lng, label: p.name }))} routes={!!chosen} />
      <div className="glance"><div className="display h2">At a glance</div><Facts rows={facts} /></div>
    </>
  );
}

export function HostMeetup({ me, id, sub, pid, m, setM }: { me: Me; id: string; sub?: string; pid?: string; m: M; setM: (m: M) => void }) {
  const [run, busy, error, clear] = useAction();
  const [toast, setToast] = useState<string | null>(null);
  const [step, setStep] = useState<string>('');
  const [keys, setKeys] = useState<string[]>(m.myCategories);
  const [theme, setTheme] = useState<'pink' | 'gold'>(me.plan === 'pro' && me.theme === 'gold' ? 'gold' : 'pink');
  const [ids, setIds] = useState<string[]>([]);
  const [pick, setPick] = useState<string>('');
  const [choice, setChoice] = useState<{ kind: string; options: string[] } | null>(null);
  const [typing, setTyping] = useState(false);
  const call = (path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') => run(async () => setM((await api(method, `/meetups/${id}${path}`, body)).meetup));
  const base = `/m/${id}`;
  const tz = m.timeZone;
  const sched = when(m.startsAt, tz);
  const hosting = sched;
  const linkCard = (
    <div className="card row" style={{ padding: '10px 12px' }}>
      <div className="grow stack" style={{ gap: 0 }}><strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.link.replace(/^https?:\/\//, '')}</strong><span className="small">{m.guestTheme === 'gold' ? 'Gold' : 'Pink'} theme</span></div>
      <button className="btn" style={{ width: 'auto', minHeight: 44, fontSize: 14, background: 'var(--sel)', color: 'var(--sel-text)', padding: '0 14px' }} onClick={async () => setToast((await copyText(m.link)) ? 'Link copied' : m.link)}>Copy link</button>
    </div>
  );
  const share = async () => {
    if (navigator.share) await navigator.share({ title: m.name, text: `${me.display_name} invited you to ${m.name}`, url: m.link }).catch(() => {});
    else setToast((await copyText(m.link)) ? 'Link copied' : m.link);
  };

  // ----- sub-pages -----
  if (sub === 'edit') return <EditMeetup m={m} base={base} call={call} busy={busy} error={error} pro={me.plan === 'pro'} />;
  if (sub === 'changes') return <Changes m={m} id={id} base={base} call={call} busy={busy} />;
  if (sub === 'person') {
    const p = m.people.find((x: M) => x.id === pid);
    if (!p) return <><Header title="Guest" back={base} /><main className="screen"><Note>That person is not on the list.</Note></main></>;
    return (
      <>
        <Header title={p.name} sub={`Guest · ${m.name}`} back={base} />
        <main className="screen">
          <Facts rows={[['Reply', p.rsvp === 'none' ? 'No reply' : p.rsvp === 'no' ? "Can't go" : p.rsvp[0].toUpperCase() + p.rsvp.slice(1)], ['Food', p.voted ? 'Voted' : 'Not voted yet'], ['Start', p.hasLocation ? 'Shared' : 'Not shared'], ['Code', p.claimed ? 'Set' : 'Not joined yet']]} />
          <Oops>{error}</Oops>
          {!p.voted && !p.skipped && m.status === 'voting' && <Btn kind="second" busy={busy} onClick={() => call(`/people/${p.id}/skip`)}>Skip {p.name} for this vote</Btn>}
          {p.claimed && <Btn kind="second" busy={busy} onClick={async () => (await call(`/people/${p.id}/reset-code`)) && setToast('Code reset')}>Reset their code</Btn>}
          <p className="small">Only if {p.name} asks. They get a new code next time they open the link.</p>
          <Btn kind="text" className="push" onClick={() => run(async () => { setM((await api('DELETE', `/meetups/${id}/people/${p.id}`)).meetup); navigate(base, true); })}>Remove {p.name} from the meetup</Btn>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- draft: your vote first, then send the link -----
  if (m.status === 'draft') {
    if (step !== 'share' && m.maxVotes > 0 && (m.myCategories.length === 0 || step === 'vote')) {
      const flip = (k: string) => setKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length < m.maxVotes ? [...cur, k] : cur));
      return (
        <>
          <Header title={m.name} sub="You vote first" back="/" step={1} />
          <main className="screen" style={{ gap: 10 }}>
            <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h2 className="display h1">Your vote</h2><p className="small" style={{ fontSize: 14 }}>Pick up to {m.maxVotes}.</p></div><Chip>{keys.length} of {m.maxVotes}</Chip></div>
            <div className="stack">{m.ballot.map((b: M) => <Pick key={b.key} on={keys.includes(b.key)} onClick={() => flip(b.key)} lead={<Icon name={b.icon} size={30} />} title={b.name} meta={b.own ? 'Yours' : undefined} />)}</div>
            <Oops>{error}</Oops>
            <Btn className="push" busy={busy} disabled={keys.length === 0} onClick={async () => (await call('/vote', { keys })) && setStep('share')}>Vote, then share the link</Btn>
          </main>
        </>
      );
    }
    const pro = me.plan === 'pro';
    return (
      <>
        <Header title={m.name} sub="Ready to share" onBack={m.maxVotes > 0 ? () => setStep('vote') : undefined} back={m.maxVotes > 0 ? undefined : '/'} step={1} />
        <main className="screen">
          <h2 className="display h1">Share the link</h2>
          <div className="row between"><span className="label">Guest theme</span></div>
          <div className="grid2">
            <button className="theme-tile" aria-pressed={theme === 'pink'} onClick={() => setTheme('pink')}><span className="bar" style={{ background: 'var(--pink)' }} /><strong style={{ fontWeight: 800 }}>Pink</strong></button>
            {pro ? <button className="theme-tile" aria-pressed={theme === 'gold'} onClick={() => setTheme('gold')}><span className="bar" style={{ background: 'var(--gold)' }} /><strong style={{ fontWeight: 800 }}>Gold</strong></button>
              : <Link to="/pro" className="theme-tile locked"><Chip kind="pro">Pro</Chip><span className="bar" style={{ background: 'var(--gold)' }} /><strong style={{ fontWeight: 800, color: 'var(--text)' }}>Gold</strong></Link>}
          </div>
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} onClick={async () => (await call('/share', { guestTheme: theme })) && share()}>Share</Btn>
        </main>
      </>
    );
  }

  const people = (
    <div className="card" style={{ padding: '2px 12px' }}>
      {m.people.map((p: M) => {
        const text = p.isHost ? 'Going · voted' : p.rsvp === 'none' ? (p.claimed ? 'No reply' : 'Not joined') : `${p.rsvp === 'no' ? "Can't go" : p.rsvp[0].toUpperCase() + p.rsvp.slice(1)}${p.rsvp === 'no' ? '' : p.voted ? ' · voted' : p.skipped ? ' · skipped' : ' · not voted'}`;
        return <Person key={p.id} name={p.name} tag={p.isHost ? 'host' : undefined} to={p.isHost ? undefined : `${base}/p/${p.id}`} right={<Chip kind={p.voted || p.isHost ? undefined : 'plain'}>{text}</Chip>} />;
      })}
    </div>
  );
  const foodTally = <Tally rows={m.categoryTally.map((t: M) => ({ label: catName(m, t.key), votes: t.votes }))} total={Math.max(1, ...m.categoryTally.map((t: M) => t.votes))} />;

  // ----- date vote -----
  if (m.status === 'date_vote') {
    if (step === 'date') {
      const top = [...m.dates].sort((a: M, b: M) => b.votes - a.votes)[0];
      const sel = pick || top.id;
      return (
        <>
          <Header title={m.name} sub="Date vote" onBack={() => setStep('')} />
          <main className="screen">
            <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h2 className="display h1">Set the date</h2></div><Chip>{m.dateAnswered} of {m.people.length}</Chip></div>
            <div className="stack" role="radiogroup" aria-label="Date">{m.dates.map((d: M) => <Pick key={d.id} radio on={sel === d.id} onClick={() => setPick(d.id)} title={when(d.startsAt, tz)} meta={d.names.join(', ')} right={<span className="row">{d.id === top.id && <Chip>Most votes</Chip>}<span className="display h1">{d.votes}</span></span>} />)}</div>
            <p className="small">Whoever picked it is marked as going.</p>
            <Oops>{error}</Oops>
            <Btn className="push" busy={busy} onClick={async () => (await call('/date', { id: sel })) && setStep('')}>Set {when(m.dates.find((d: M) => d.id === sel).startsAt, tz)}</Btn>
          </main>
        </>
      );
    }
    return (
      <>
        <Header title={m.name} sub="Voting" back="/" step={1} />
        <main className="screen" style={{ gap: 10 }}>
          {linkCard}
          <div className="card stack" style={{ gap: 10 }}><div className="row between"><strong style={{ fontSize: 14 }}>Dates</strong><Chip>{m.dateAnswered} of {m.people.length} answered</Chip></div><Tally rows={m.dates.map((d: M) => ({ label: when(d.startsAt, tz).split(',')[0]!, votes: d.votes }))} total={m.people.length} /></div>
          <div className="card stack" style={{ gap: 10 }}><div className="row between"><strong style={{ fontSize: 14 }}>Food votes · up to {m.maxVotes} each</strong></div>{foodTally}</div>
          {people}
          <div className="push stack"><Btn onClick={() => setStep('date')}>Set the date</Btn></div>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- category vote: wait or skip, then find the middle -----
  if (m.status === 'voting') {
    const waiting = m.people.filter((p: M) => m.waiting.includes(p.id));
    const findMiddle = (extra: M = {}) => run(async () => {
      try {
        if (!m.hasLocation) setM((await api('POST', `/meetups/${id}/location`, await locate())).meetup);
        setM((await api('POST', `/meetups/${id}/middle`, extra)).meetup);
        setChoice(null);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'tie') return setChoice({ kind: 'tie', options: e.data.leaders });
        if (e instanceof ApiError && e.code === 'no_places') return setChoice({ kind: 'no_places', options: m.ballot.map((b: M) => b.key).filter((k: string) => k !== extra.key) });
        throw e;
      }
    });
    if (choice) {
      return (
        <>
          <Header title={m.name} sub={hosting} onBack={() => { clear(); setChoice(null); }} step={1} />
          <main className="screen">
            <h2 className="display h1">{choice.kind === 'tie' ? "It's a tie" : 'No places nearby'}</h2>
            <p className="small" style={{ fontSize: 14 }}>{choice.kind === 'tie' ? 'You decide.' : 'Pick another option.'}</p>
            <div className="stack">{choice.options.map((k) => <Pick key={k} radio on={pick === k} onClick={() => setPick(k)} lead={<Icon name={m.ballot.find((b: M) => b.key === k)?.icon ?? 'star'} size={30} />} title={catName(m, k)} meta={`${m.categoryTally.find((t: M) => t.key === k)?.votes ?? 0} votes`} />)}</div>
            <Oops>{error}</Oops>
            <Btn className="push" busy={busy} disabled={!choice.options.includes(pick)} onClick={() => findMiddle({ key: pick, override: choice.kind === 'no_places' })}>Go with {choice.options.includes(pick) ? catName(m, pick) : '…'}</Btn>
          </main>
        </>
      );
    }
    return (
      <>
        <Header title={m.name} sub={hosting} back="/" step={1} />
        <main className="screen" style={{ gap: 10 }}>
          {linkCard}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, fontSize: 13, fontWeight: 800 }}>RSVP<Chip kind="sel">{m.counts.going} going</Chip><Chip kind="plain">{m.counts.maybe} maybe</Chip><Chip kind="plain">{m.counts.noReply} no reply</Chip></div>
          <div className="card stack" style={{ gap: 10 }}><div className="row between"><strong style={{ fontSize: 14 }}>Food votes</strong></div>{foodTally}</div>
          {people}
          <Oops>{error}</Oops>
          <div className="push stack">
            {waiting.length > 0 ? (
              <>
                <p className="center pulse" style={{ fontWeight: 800, fontSize: 15 }}>Waiting for {waiting.map((p: M) => p.name).join(', ')} to vote</p>
                <Btn kind="second" busy={busy} onClick={() => run(async () => { let cur = m; for (const p of waiting) cur = (await api('POST', `/meetups/${id}/people/${p.id}/skip`)).meetup; setM(cur); })}>Skip {waiting.length === 1 ? waiting[0].name : 'them'} and continue</Btn>
              </>
            ) : (
              <>
                {typing ? (
                  <>
                    <StartPicker saving={busy} search={async (q) => (await api('POST', `/meetups/${id}/start-search`, { q })).results} onPick={(at) => run(async () => { setM((await api('POST', `/meetups/${id}/location`, at)).meetup); setTyping(false); })} />
                    <Btn kind="text" onClick={() => setTyping(false)}>Use my location instead</Btn>
                  </>
                ) : (
                  <>
                    <p className="small center">{m.hasLocation ? 'Everyone has voted.' : 'Uses your location once.'}</p>
                    <Btn busy={busy} onClick={() => findMiddle()}>Find the middle</Btn>
                    <Btn kind="text" onClick={() => setTyping(true)}>{m.hasLocation ? 'Change my start' : 'Type a place instead'}</Btn>
                  </>
                )}
              </>
            )}
          </div>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- places: shortlist, then your own pick -----
  if (m.status === 'places') {
    const sel = ids;
    const flip = (pid2: string) => setIds((cur) => (cur.includes(pid2) ? cur.filter((x) => x !== pid2) : cur.length < m.maxShortlist ? [...cur, pid2] : cur));
    const longest = Math.max(0, ...m.people.map((p: M) => p.minutes ?? 0));
    if (step === 'own' && sel.length > 1) {
      return (
        <>
          <Header title={m.name} sub={`${catName(m, m.winner)} · you vote first`} onBack={() => setStep('')} step={3} />
          <main className="screen">
            <h2 className="display h1">Your pick</h2>
            <div className="stack" role="radiogroup" aria-label="Place">{m.places.filter((p: M) => sel.includes(p.id)).map((p: M) => <Pick key={p.id} radio on={pick === p.id} onClick={() => setPick(p.id)} title={p.name} meta={`${p.rating ? `★ ${p.rating} · ` : ''}up to ${p.longest} min`} />)}</div>
            <Oops>{error}</Oops>
            <Btn className="push" busy={busy} disabled={!sel.includes(pick)} onClick={async () => (await call('/shortlist', { ids: sel, hostPick: pick })) && share()}>Vote and share</Btn>
          </main>
        </>
      );
    }
    return (
      <>
        <Header title={m.name} sub={catName(m, m.winner)} back="/" step={3} />
        <main className="screen" style={{ gap: 10 }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h2 className="display h1">Closest to everyone</h2><p className="small">{sel.length === 1 ? 'One place: no vote needed.' : `Pick 1, or up to ${m.maxShortlist} for a vote.`}{m.places.some((p: M) => p.routed) ? '' : ' Times are estimates.'}</p></div><Chip>{sel.length} of {m.maxShortlist}</Chip></div>
          <Facts rows={[['Middle', `Up to ${longest} min for anyone`]]} />
          <div className="stack" style={{ gap: 6 }}>{m.places.map((p: M, i: number) => <Pick key={p.id} on={sel.includes(p.id)} onClick={() => flip(p.id)} lead={<span className="display h2" style={{ width: 22, color: 'var(--muted)' }}>{i + 1}</span>} title={p.name} meta={`${p.rating ? `★ ${p.rating} · ` : ''}up to ${p.longest} min${p.openNow === false ? ' · closed now' : ''}`} />)}</div>
          <Sponsored placement="shortlist" category={m.winner} show={me.plan !== 'pro'} />
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={sel.length === 0} onClick={() => (sel.length === 1 ? call('/shortlist', { ids: sel }) : setStep('own'))}>{sel.length === 1 ? `Lock in ${m.places.find((p: M) => p.id === sel[0]).name}` : 'Next'}</Btn>
        </main>
      </>
    );
  }

  // ----- final vote -----
  if (m.status === 'place_vote') {
    const short = m.places.filter((p: M) => p.shortlisted).sort((a: M, b: M) => b.votes - a.votes);
    const voted = m.people.filter((p: M) => p.votedPlace).length;
    const tie = m.placeLeaders.length > 1;
    const sel = short.some((p: M) => p.id === pick) ? pick : tie ? '' : short[0].id;
    return (
      <>
        <Header title={m.name} sub="Final vote" back="/" step={3} />
        <main className="screen">
          <div className="row between" style={{ alignItems: 'flex-end' }}><div className="stack" style={{ gap: 2 }}><h2 className="display h1">Final vote</h2></div><Chip>{voted} of {m.people.filter((p: M) => p.rsvp !== 'no').length} voted</Chip></div>
          {linkCard}
          <div className="stack" role="radiogroup" aria-label="Place to lock in">{short.map((p: M) => <Pick key={p.id} radio on={sel === p.id} onClick={() => setPick(p.id)} title={p.name} meta={`${p.votes} ${p.votes === 1 ? 'vote' : 'votes'} · up to ${p.longest} min`} />)}</div>
          {tie && <Note>It's a tie. You pick.</Note>}
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={!sel} onClick={() => call('/lock', { id: sel })}>Lock in {sel ? short.find((p: M) => p.id === sel).name : 'a place'}</Btn>
          <Toast text={toast} onDone={() => setToast(null)} />
        </main>
      </>
    );
  }

  // ----- confirmed -----
  const place = m.places.find((p: M) => p.id === m.chosenPlace);
  return (
    <>
      <Header title={m.name} sub={m.status === 'ended' ? 'Ended' : 'Confirmed'} back="/" step={4} />
      <main className="screen">
        <div className="row" style={{ gap: 14 }}><Mascot size={64} bob /><h2 className="display h1">It's on</h2></div>
        <Facts rows={[['When', sched], ['Food', m.winner ? catName(m, m.winner) : '—'], ['Place', place ? `${place.name}${place.address ? ` · ${place.address}` : ''}` : '—'], ['Coming', `${m.counts.going} going`], ['Theme', m.guestTheme === 'gold' ? 'Gold' : 'Pink']]} />
        {m.unseenChanges > 0 && <Link to={`${base}/changes`} className="note ok pop" style={{ textDecoration: 'none', alignItems: 'center' }}><span className="grow">{m.unseenChanges} guest {m.unseenChanges === 1 ? 'change' : 'changes'} since you confirmed</span><Chevron /></Link>}
        {people}
        <div className="push stack" style={{ gap: 10 }}><Btn onClick={share}>Share the plan</Btn><Btn kind="second" to={`${base}/edit`}>Edit</Btn></div>
        <Toast text={toast} onDone={() => setToast(null)} />
      </main>
    </>
  );
}

function EditMeetup({ m, base, call, busy, error, pro }: { m: M; base: string; call: (path: string, body?: unknown, method?: 'POST' | 'PATCH') => Promise<boolean>; busy: boolean; error: string | null; pro: boolean }) {
  const [name, setName] = useState<string>(m.name);
  const [start, setStart] = useState(m.startsAt ? toLocalInput(new Date(m.startsAt)) : '');
  const [clear, setClear] = useState(false);
  const [theme, setTheme] = useState<'pink' | 'gold'>(m.guestTheme);
  const iso = fromLocalInput(start);
  const dateChanged = !!iso && !!m.startsAt && new Date(iso).getTime() !== new Date(m.startsAt).getTime();
  const save = async () => (await call('', { ...(name.trim() !== m.name ? { name } : {}), ...(dateChanged ? { startsAt: iso, clearReplies: clear } : {}), ...(theme !== m.guestTheme ? { guestTheme: theme } : {}) }, 'PATCH')) && navigate(base);
  return (
    <>
      <Header title="Edit meetup" sub={m.name} back={base} />
      <main className="screen" style={{ gap: 14 }}>
        <Field label="Meetup name" value={name} max={LIMITS.meetupName} onChange={setName} />
        {m.startsAt && <Field label="Date and time" type="datetime-local" value={start} onChange={setStart} />}
        {dateChanged && (
          <>
            <Switch on={clear} onChange={setClear} title="Ask everyone to reply again"  />
            {clear ? <Note>Everyone's reply will be cleared.</Note> : <Note ok>Replies are kept: {m.counts.going} going.</Note>}
          </>
        )}
        <div className="stack"><span className="label">Guest theme</span><Seg value={theme} onChange={setTheme} options={[{ value: 'pink', label: 'Pink' }, { value: 'gold', label: 'Gold', locked: !pro }]} /></div>
        <Oops>{error}</Oops>
        <div className="push stack" style={{ gap: 10 }}><Btn busy={busy} disabled={!name.trim()} onClick={save}>Save</Btn><Btn kind="second" to={base}>Cancel</Btn></div>
      </main>
    </>
  );
}

function Changes({ m, id, base, call, busy }: { m: M; id: string; base: string; call: (path: string, body?: unknown) => Promise<boolean>; busy: boolean }) {
  const [rows, setRows] = useState<M[] | null>(null);
  useEffect(() => { api('GET', `/meetups/${id}/changes`).then((r) => setRows(r.changes)).catch(() => setRows([])); }, [id]);
  const ago = (iso: string) => { const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} hr ago`; };
  return (
    <>
      <Header title="Guest changes" sub={m.name} back={base} />
      <main className="screen">
        {!rows ? <Loading /> : rows.length === 0 ? <Note>No changes yet.</Note> : <div className="card" style={{ padding: '2px 12px' }}>{rows.map((r) => <div key={r.id} className="person"><span className="avatar">{(r.name ?? '?')[0]}</span><span className="grow stack" style={{ gap: 0 }}><strong>{r.name}</strong><span className="small">{r.detail}</span></span><span className="small" style={{ fontSize: 12 }}>{ago(r.at)}</span></div>)}</div>}
        <div className="push stack" style={{ gap: 10 }}><Btn busy={busy} onClick={async () => (await call('/changes/seen')) && navigate(base)}>Mark as seen</Btn><Btn kind="second" to={`${base}/edit`}>Edit</Btn></div>
      </main>
    </>
  );
}

export { Check };
