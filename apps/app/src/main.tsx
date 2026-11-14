import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/rubik';
import './theme.css';
import { Account, Pro, ProWelcome } from './account';
import { SignIn } from './auth';
import { GuestFlow, GuestPane, useGuestMeetup } from './guestflow';
import { Create, Home, HostMeetup, HostPane, useMeetup } from './host';
import { ApiError, type Me, Session, api, match, navigate, useMode, usePath } from './lib';
import { CrewMap } from './map';
import { useEmailLink } from './updates';
import { Shell } from './shell';
import { Btn, ErrorScreen, Loading, Toast } from './ui';

function HostRoute({ me, id, sub, pid, mode }: { me: Me; id: string; sub?: string; pid?: string; mode: 'light' | 'dark' }) {
  const { m, setM, missing } = useMeetup(id);
  const theme = me.features.goldTheme ? me.theme : 'pink';
  return (
    <Shell me={me} theme={theme} mode={mode} pane={m ? <HostPane m={m} /> : undefined}>
      {missing ? <ErrorScreen title="Meetup not found" text="It may have been deleted, or it belongs to another account." action={<Btn to="/">Back to my meetups</Btn>} /> : m ? <HostMeetup key={`${m.status}:${sub ?? ''}:${pid ?? ''}`} me={me} id={id} sub={sub} pid={pid} m={m} setM={setM} /> : <Loading />}
    </Shell>
  );
}

function GuestRoute({ token, me, mode }: { token: string; me: Me | null; mode: 'light' | 'dark' }) {
  const { m, setM, gone, refresh } = useGuestMeetup(token);
  const [notice, clearNotice] = useEmailLink(token, refresh);
  return (
    <Shell me={me} guest theme={m?.theme ?? 'pink'} mode={mode} ads={!!m?.ads} pane={m ? <GuestPane m={m} /> : undefined}>
      {gone ? <ErrorScreen title="Link not active" text={gone} /> : m ? <GuestFlow token={token} m={m} setM={setM} /> : <Loading />}
      <Toast text={notice} onDone={clearNotice} />
    </Shell>
  );
}

function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [down, setDown] = useState(false);
  const [mode, modeChoice, setMode] = useMode();
  const refresh = useCallback(async () => {
    try {
      const r = await api('GET', '/auth/me');
      setMe(r.user ? { ...r.user, telegram_ready: !!r.telegram, features: r.features } : null);
      setDown(false);
    } catch (e) {
      // A server that can't answer is not the same as being signed out.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setMe(null);
      else setDown(true);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0B0B0D' : '#FFFFFF'); }, [mode]);

  const guest = match('/j/:token', path);
  const theme = me?.features?.goldTheme ? me.theme : 'pink';
  let page;
  const known = guest || ['/', '/sign-in', '/new', '/account', '/pro', '/pro/welcome'].includes(path) || /^\/m\/[^/]+(\/[^/]+|\/p\/[^/]+)?$/.test(path);
  if (down) page = <Shell me={null} theme="pink" mode={mode}><ErrorScreen title="Zorion can't reach its server" text="Check your connection, then try again." action={<Btn onClick={refresh}>Try again</Btn>} /></Shell>;
  else if (!known) page = <Shell me={me ?? null} theme={theme} mode={mode}><ErrorScreen title="Page not found" text="That page isn't here." action={<Btn to="/">Go to Zorion</Btn>} /></Shell>;
  else if (me === undefined) page = <Shell me={null} theme="pink" mode={mode}><Loading /></Shell>;
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
      const inner = path === '/new' ? <Create me={me} /> : path === '/account' ? <Account me={me} modeChoice={modeChoice} setMode={setMode} /> : path === '/pro' ? <Pro me={me} /> : path === '/pro/welcome' ? <ProWelcome /> : <Home me={me} />;
      const proPage = path.startsWith('/pro');
      page = <Shell me={me} theme={proPage ? 'gold' : theme} mode={proPage ? 'dark' : mode} tabs={['/', '/account', '/sign-in'].includes(path)} pane={<CrewMap label="Map with a fair middle" />}>{inner}</Shell>;
    }
  }
  return <Session.Provider value={{ me: me ?? null, refresh }}>{page}</Session.Provider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (location.pathname === '/sign-in' && history.length < 2) navigate('/', true);
