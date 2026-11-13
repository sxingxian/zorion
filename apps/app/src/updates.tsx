import { useEffect, useState } from 'react';
import { api, useAction } from './lib';
import { Btn, Field, Note, Oops } from './ui';

type M = Record<string, any>;

/**
 * Optional email updates for a guest. Off unless they ask, confirmed from their own inbox,
 * never shown to the host or the crew, and forgotten when the meetup ends or they stop it.
 */
export function EmailUpdates({ token, m, setM }: { token: string; m: M; setM: (m: M) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [run, busy, error] = useAction();
  const mine = m.me?.email as { address: string; confirmed: boolean } | null;
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  const stop = () => run(async () => { setM((await api('POST', `/g/${token}/email/stop`, {})).meetup); setOpen(false); setEmail(''); });

  if (mine?.confirmed) {
    return <div className="card row between" style={{ gap: 10 }}><span className="small" style={{ fontSize: 14 }}>Email updates go to <strong>{mine.address}</strong></span><button className="btn text" style={{ width: 'auto' }} disabled={busy} onClick={stop}>Stop</button></div>;
  }
  if (mine) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <Note ok>Check {mine.address} and open the link to confirm. Nothing else is sent until you do.</Note>
        <Oops>{error}</Oops>
        <button className="btn text" disabled={busy} onClick={stop}>Use another address, or cancel</button>
      </div>
    );
  }
  if (!open) return <Btn kind="text" onClick={() => setOpen(true)}>{m.status === 'confirmed' ? 'Email me if the plan changes' : 'Email me when the place is set'}</Btn>;
  return (
    <form className="card stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (valid && !busy) run(async () => setM((await api('POST', `/g/${token}/email`, { email: email.trim() })).meetup)); }}>
      <Field label="Your email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={setEmail} />
      <Oops>{error}</Oops>
      <Btn kind="second" type="submit" busy={busy} disabled={!valid}>Email me updates</Btn>
      <p className="small">Only for this meetup. The host and the crew never see your address, and it is erased when the meetup ends. Every email has a link to stop them.</p>
    </form>
  );
}

/**
 * Handles the links inside emails: `?confirm=` turns updates on, `?stop=` turns them off.
 * Returns a short line to show the person, or null.
 */
export function useEmailLink(token: string, refresh: () => void): [notice: string | null, clear: () => void] {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const confirm = q.get('confirm');
    const stop = q.get('stop');
    if (!confirm && !stop) return;
    window.history.replaceState(null, '', window.location.pathname); // keep the link's secret out of the address bar and history
    api('POST', `/g/${token}/email/${confirm ? 'confirm' : 'stop'}`, { t: confirm ?? stop })
      .then((r) => setNotice(confirm ? `Email updates are on${r.name ? ` for ${r.name}` : ''}.` : 'Email updates are off. Your address is forgotten.'))
      .catch((e) => setNotice(e instanceof Error ? e.message : 'That link did not work.'))
      .finally(refresh);
  }, [token, refresh]);
  return [notice, () => setNotice(null)];
}
