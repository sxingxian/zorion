import type { ReactNode } from 'react';
import { Pro } from './account';
import { Link, Look, type Me, closeSheet, useSheet } from './lib';
import { Btn, Cross, Mascot, Pig, Plus } from './ui';

/**
 * One layout for every size: a slim top bar, then the screen. On a desktop, screens that have one
 * get a second column (the map and "At a glance") that stays in view while the screen scrolls.
 * Pro and Install open as sheets over whatever is on screen, and closing them goes back to it.
 */
export function Shell({ children, aside, me, theme, mode, guest = false, wide = false }: { children: ReactNode; aside?: ReactNode; me: Me | null; theme: 'pink' | 'gold'; mode: 'light' | 'dark'; guest?: boolean; wide?: boolean }) {
  const host = !!me && !guest;
  const sheet = useSheet();
  return (
    <Look.Provider value={{ theme, mode }}>
      <div className="app" data-theme={theme} data-mode={mode}>
        <header className="topbar">
          <div className="topbar-in">
            {host ? (
              <Link to="/" className="brandmark" aria-label="Zorion, your meetups"><Mascot size={34} /><span className="wordmark">Zorion</span></Link>
            ) : (
              <span className="brandmark"><Mascot size={34} /><span className="wordmark">Zorion</span></span>
            )}
            {host && (
              <span className="row" style={{ gap: 12 }}>
                <span className="only-wide"><Btn to="/new" className="sm"><Plus />New meetup</Btn></span>
                <Link to="/account" className="me" aria-label="Account"><Pig avatar={me.avatar} size={40} /></Link>
              </span>
            )}
          </div>
        </header>
        <div className="page">
          <div className={`layout ${aside ? 'two' : ''}`}>
            <div className={`main ${aside || wide ? '' : 'narrow'}`}>{children}</div>
            {aside && <aside className="aside">{aside}</aside>}
          </div>
        </div>
        {host && sheet === 'pro' && <Sheet dark label="Zorion Pro"><Pro me={me} sheet /></Sheet>}
        {sheet === 'install' && <Sheet label="Add to home screen"><InstallSteps /></Sheet>}
      </div>
    </Look.Provider>
  );
}

/** A sheet over the screen. Close (or Back) returns to the screen underneath. */
function Sheet({ children, label, dark }: { children: ReactNode; label: string; dark?: boolean }) {
  return (
    <div className="scrim" onClick={closeSheet}>
      <div className={`sheetbox ${dark ? 'dark' : ''}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} {...(dark ? { 'data-mode': 'dark', 'data-theme': 'gold' } : {})}>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="sq" aria-label="Close" onClick={closeSheet}><Cross /></button></div>
        {children}
      </div>
    </div>
  );
}

const SHARE = 'M12 3 V15 M7.5 7.5 L12 3 L16.5 7.5 M6 11 H5 V21 H19 V11 H18';
const ADD = 'M8 4 H16 A4 4 0 0 1 20 8 V16 A4 4 0 0 1 16 20 H8 A4 4 0 0 1 4 16 V8 A4 4 0 0 1 8 4 Z M12 8 V16 M8 12 H16';
function InstallSteps() {
  const steps: Array<[string, ReactNode]> = [
    ['Tap Share in Safari', <svg key="s" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true"><path d={SHARE} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>],
    ['Choose Add to Home Screen', <svg key="a" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true"><path d={ADD} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>],
    ['Tap Add', <b key="b" style={{ fontSize: 13 }}>Add</b>],
  ];
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h2 className="display h1">Add to home screen</h2>
      <div className="row"><span className="appicon"><Mascot size={44} /></span><span className="stack" style={{ gap: 0 }}><strong>Zorion</strong><span className="small">Opens full screen</span></span></div>
      <ol className="stack stagger" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 14 }}>
        {steps.map(([t, icon], i) => <li key={t} className="row"><span className="num">{i + 1}</span><span className="grow" style={{ fontWeight: 600 }}>{t}</span><span className="sq">{icon}</span></li>)}
      </ol>
      <Btn kind="second" onClick={closeSheet}>Done</Btn>
    </div>
  );
}
