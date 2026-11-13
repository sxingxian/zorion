import type { ReactNode } from 'react';
import { Link, Look, type Me, usePath } from './lib';
import { Chip, Mascot, Sponsored } from './ui';

const NAV: Array<[label: string, to: string, icon: string]> = [
  ['Meetups', '/', 'M12 21 C12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21 12 21 Z'],
  ['Account', '/account', 'M12 12.5 A4 4 0 1 0 12 4.5 A4 4 0 0 0 12 12.5 M4.5 20 C4.5 14.5 19.5 14.5 19.5 20'],
];
const NavIcon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true"><path d={d} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg>
);
function NavLinks() {
  const path = usePath();
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map(([label, to, d], i) => (
        <Link key={to} to={to} aria-current={(to === '/' ? !path.startsWith('/account') && !path.startsWith('/pro') : path.startsWith(to)) ? 'page' : undefined}><NavIcon d={d} filled={i === 0} />{label}</Link>
      ))}
    </nav>
  );
}

/**
 * One layout for every size. Phone: the screen alone, with a tab bar on top-level pages.
 * Tablet: a rail, the screen and a context pane. Desktop: a sidebar, the screen and a context pane.
 * Guests and signed-out visitors get a brand panel instead of navigation.
 */
export function Shell({ children, pane, me, theme, mode, guest = false, tabs = false, ads = false }: { children: ReactNode; pane?: ReactNode; me: Me | null; theme: 'pink' | 'gold'; mode: 'light' | 'dark'; guest?: boolean; tabs?: boolean; ads?: boolean }) {
  const host = !!me && !guest;
  return (
    <Look.Provider value={{ theme, mode }}>
      <div className={`app ${host ? 'host' : 'guest'}`} data-theme={theme} data-mode={mode}>
        {host ? (
          <>
            <aside className="side">
              <span className="row"><Mascot size={38} /><span className="wordmark">Zorion</span></span>
              <NavLinks />
              <div className="push stack" style={{ gap: 12 }}>
                <Sponsored placement="host_home" show={me.plan !== 'pro'} />
                {me.plan === 'pro' ? <span className="row" style={{ fontWeight: 800, fontSize: 14 }}><Mascot size={40} />Pro <Chip kind="pro">Pro</Chip></span> : <Link to="/pro" className="btn second" style={{ minHeight: 44, fontSize: 14 }}>Free · Go Pro</Link>}
              </div>
            </aside>
            <aside className="rail">
              <span style={{ alignSelf: 'center' }}><Mascot size={48} /></span>
              <NavLinks />
              <div className="push">{me.plan === 'pro' ? <Chip kind="pro">Pro</Chip> : <Link to="/pro" className="btn second" style={{ minHeight: 44, fontSize: 11, padding: 4 }}>Go Pro</Link>}</div>
            </aside>
          </>
        ) : (
          <aside className="brand">
            <span className="row"><Mascot size={38} /><span className="wordmark">Zorion</span></span>
            <div className="grow row" style={{ justifyContent: 'center' }}><Mascot size={230} full bob label="Zorion the black pig" /></div>
            <div className="stack">
              <div className="display h0">{guest ? 'One link, no account.' : 'Plan a meetup your whole crew can walk to.'}</div>
              <p style={{ color: 'var(--muted)' }}>{guest ? 'Vote on the food, share where you are once, and meet in the fair middle.' : 'Hosts sign in. Guests join from a link and never need an account.'}</p>
            </div>
            {guest && <Sponsored placement="guest_vote" show={ads} />}
          </aside>
        )}
        <div className="col">
          {children}
          {host && tabs && (
            <nav className="tabbar" aria-label="Tabs">
              <TabLink to="/" label="Meetups" d={NAV[0]![2]} filled />
              <TabLink to="/pro" label={me.plan === 'pro' ? 'Pro' : 'Go Pro'} d="M12 3 L14.6 9 L21 9.6 L16.2 13.8 L17.6 20 L12 16.8 L6.4 20 L7.8 13.8 L3 9.6 L9.4 9 Z" />
              <TabLink to="/account" label="Account" d={NAV[1]![2]} />
            </nav>
          )}
        </div>
        <div className="pane" aria-hidden={!pane}>{pane}</div>
      </div>
    </Look.Provider>
  );
}
function TabLink({ to, label, d, filled }: { to: string; label: string; d: string; filled?: boolean }) {
  const path = usePath();
  return <Link to={to} aria-current={path === to ? 'page' : undefined}><NavIcon d={d} filled={filled} />{label}</Link>;
}
