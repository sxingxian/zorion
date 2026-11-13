import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/rubik';
import './theme.css';
import { Account, Pro, ProWelcome } from './account';
import { SignIn } from './auth';
import { GuestFlow, GuestPane, useGuestMeetup } from './guestflow';
import { Create, Home, HostMeetup, HostPane, useMeetup } from './host';
import { type Me, Session, api, match, navigate, useMode, usePath } from './lib';
import { CrewMap } from './map';
import { useEmailLink } from './updates';
import { Shell } from './shell';
import { Btn, Header, Loading, Note, Toast } from './ui';

function HostRoute({ me, id, sub, pid, mode }: { me: Me; id: string; sub?: string; pid?: string; mode: 'light' | 'dark' }) {
  const { m, setM, missing } = useMeetup(id);
  const theme = me.plan === 'pro' ? me.theme : 'pink';
  return (
    <Shell me={me} theme={theme} mode={mode} pane={m ? <HostPane m={m} /> : undefined}>
      {missing ? <><Header title="Not found" back="/" /><main className="screen"><Note>Meetup not found.</Note></main></> : m ? <HostMeetup key={`${m.status}:${sub ?? ''}:${pid ?? ''}`} me={me} id={id} sub={sub} pid={pid} m={m} setM={setM} /> : <Loading />}
    </Shell>
  );
}

function GuestRoute({ token, me, mode }: { token: string; me: Me | null; mode: 'light' | 'dark' }) {
  const { m, setM, gone, refresh } = useGuestMeetup(token);
  const [notice, clearNotice] = useEmailLink(token, refresh);
  return (
    <Shell me={me} guest theme={m?.theme ?? 'pink'} mode={mode} ads={!!m?.ads} pane={m ? <GuestPane m={m} /> : undefined}>
      {gone ? <main className="screen" style={{ justifyContent: 'center', gap: 16 }}><h1 className="display h1">Link not active</h1><Note>{gone}</Note></main> : m ? <GuestFlow token={token} m={m} setM={setM} /> : <Loading />}
      <Toast text={notice} onDone={clearNotice} />
    </Shell>
  );
}

function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mode, modeChoice, setMode] = useMode();
  const refresh = useCallback(async () => {
    try {
      const r = await api('GET', '/auth/me');
      setMe(r.user ? { ...r.user, telegram_ready: !!r.telegram } : null);
    } catch {
      setMe(null);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0B0B0D' : '#FFFFFF'); }, [mode]);

  const guest = match('/j/:token', path);
  const theme = me?.plan === 'pro' ? me.theme : 'pink';
  let page;
  if (me === undefined) page = <Shell me={null} theme="pink" mode={mode}><Loading /></Shell>;
  else if (guest) page = <GuestRoute token={guest.token!} me={me} mode={mode} />;
  else if (!me) page = <Shell me={null} theme="pink" mode={mode} pane={<CrewMap label="Map with a fair middle" />}><SignIn /></Shell>;
  else {
    const m1 = match('/m/:id', path);
    const m2 = match('/m/:id/:sub', path);
    const m3 = match('/m/:id/p/:pid', path);
    if (m3) page = <HostRoute me={me} id={m3.id!} sub="person" pid={m3.pid} mode={mode} />;
    else if (m2) page = <HostRoute me={me} id={m2.id!} sub={m2.sub} mode={mode} />;
    else if (m1) page = <HostRoute me={me} id={m1.id!} mode={mode} />;
    else {
      const inner = path === '/new' ? <Create me={me} /> : path === '/account' ? <Account me={me} modeChoice={modeChoice} setMode={setMode} /> : path === '/pro' ? <Pro me={me} /> : path === '/pro/welcome' ? <ProWelcome /> : path === '/' || path === '/sign-in' ? <Home me={me} /> : <><Header title="Not found" back="/" /><main className="screen"><Note>That page does not exist.</Note><Btn className="push" to="/">Back to my meetups</Btn></main></>;
      const proPage = path.startsWith('/pro');
      page = <Shell me={me} theme={proPage ? 'gold' : theme} mode={proPage ? 'dark' : mode} tabs={['/', '/account', '/sign-in'].includes(path)} pane={<CrewMap label="Map with a fair middle" />}>{inner}</Shell>;
    }
  }
  return <Session.Provider value={{ me: me ?? null, refresh }}>{page}</Session.Provider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (location.pathname === '/sign-in' && history.length < 2) navigate('/', true);
