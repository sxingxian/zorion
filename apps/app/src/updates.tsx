import { useEffect, useState } from 'react';
import { api, useAction } from './lib';
import { Btn, Field, Note, Oops } from './ui';

type M = Record<string, any>;

/** A one-time Telegram link, shown as a button so the browser never blocks it as a pop-up. */
export function TelegramLink({ url, onCancel }: { url: string; onCancel: () => void }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong style={{ fontWeight: 800 }}>Open Telegram and press Start</strong>
      <p className="small">The link works once, for 30 minutes.</p>
      <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open Telegram</a>
      <button type="button" className="btn text" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * Optional updates for a guest, by email, Telegram or both. Off unless they ask. The same updates,
 * worded the same way, go to each channel. The host and the crew never see the address or the chat,
 * and both are forgotten when the meetup ends or the guest stops them.
 */
export function Updates({ token, m, setM }: { token: string; m: M; setM: (m: M) => void }) {
  const [step, setStep] = useState<'closed' | 'choose' | 'email' | 'telegram'>('closed');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [run, busy, error, clear] = useAction();
  const mine = m.me?.email as { address: string; confirmed: boolean } | null;
  const onTelegram = !!m.me?.telegram;
  const tgReady = !!m.telegramReady;
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  const go = (s: typeof step) => { clear(); setStep(s); };
  const post = (path: string, body: unknown = {}) => run(async () => setM((await api('POST', `/g/${token}${path}`, body)).meetup));
  const telegram = () => run(async () => { setLink((await api('POST', `/g/${token}/telegram`, {})).url); setStep('telegram'); });

  // Connected Telegram while the link was open: close it.
  useEffect(() => { if (onTelegram && step === 'telegram') { setStep('closed'); setLink(null); } }, [onTelegram, step]);

  const lines = [
    mine?.confirmed && <div key="e" className="row between" style={{ gap: 10 }}><span className="small" style={{ fontSize: 14 }}>Email: <strong>{mine.address}</strong></span><button type="button" className="btn text" style={{ width: 'auto' }} disabled={busy} onClick={() => post('/email/stop')}>Stop</button></div>,
    onTelegram && <div key="t" className="row between" style={{ gap: 10 }}><span className="small" style={{ fontSize: 14 }}>Telegram: <strong>on</strong></span><button type="button" className="btn text" style={{ width: 'auto' }} disabled={busy} onClick={() => post('/telegram/stop')}>Stop</button></div>,
  ].filter(Boolean);
  const pendingEmail = mine && !mine.confirmed;
  const canAddEmail = !mine;
  const canAddTelegram = tgReady && !onTelegram;
  const label = m.status === 'confirmed' ? 'if the plan changes' : 'when the place is set';

  if (step === 'telegram' && link) return <TelegramLink url={link} onCancel={() => { setLink(null); go('closed'); }} />;

  if (step === 'email') {
    return (
      <form className="card stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (valid && !busy) run(async () => { setM((await api('POST', `/g/${token}/email`, { email: email.trim() })).meetup); setStep('closed'); }); }}>
        <Field label="Your email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={setEmail} />
        <Oops>{error}</Oops>
        <Btn kind="second" type="submit" busy={busy} disabled={!valid}>Send updates</Btn>
        <p className="small">Only for this meetup. Nobody else sees it.</p>
        <button type="button" className="btn text" onClick={() => go('closed')}>Cancel</button>
      </form>
    );
  }

  if (step === 'choose') {
    return (
      <div className="card stack" style={{ gap: 10 }}>
        <strong style={{ fontWeight: 800 }}>Get updates {label}</strong>
        <div className="row" style={{ gap: 8 }}>
          {canAddEmail && <Btn kind="second" onClick={() => go('email')}>By email</Btn>}
          {canAddTelegram && <Btn kind="second" busy={busy} onClick={telegram}>On Telegram</Btn>}
        </div>
        <Oops>{error}</Oops>
        <button type="button" className="btn text" onClick={() => go('closed')}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {lines.length > 0 && <div className="card stack" style={{ gap: 6 }}>{lines}</div>}
      {pendingEmail && (
        <>
          <Note ok>Check {mine.address} to confirm.</Note>
          <button type="button" className="btn text" disabled={busy} onClick={() => post('/email/stop')}>Cancel</button>
        </>
      )}
      <Oops>{error}</Oops>
      {lines.length === 0 && !pendingEmail && (canAddEmail || canAddTelegram) && (
        <Btn kind="text" onClick={() => (canAddEmail && canAddTelegram ? go('choose') : canAddEmail ? go('email') : telegram())}>{`Get updates ${label}`}</Btn>
      )}
      {(lines.length > 0 || pendingEmail) && canAddTelegram && <Btn kind="text" busy={busy} onClick={telegram}>Also on Telegram</Btn>}
      {lines.length > 0 && canAddEmail && <Btn kind="text" onClick={() => go('email')}>Also by email</Btn>}
    </div>
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
      .then((r) => setNotice(confirm ? 'Email updates are on.' : 'Email updates are off.'))
      .catch((e) => setNotice(e instanceof Error ? e.message : 'That link did not work.'))
      .finally(refresh);
  }, [token, refresh]);
  return [notice, () => setNotice(null)];
}
