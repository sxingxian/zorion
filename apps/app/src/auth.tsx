import { useState } from 'react';
import { api, navigate, useAction, useSession } from './lib';
import { Btn, Codes, Field, Header, Mascot, Note, Oops, Seg } from './ui';

type Step = 'start' | 'email_code' | 'authenticator' | 'two_step';

/** Host sign-in: email code or password first; if two-step is on, a different proof last. */
export function SignIn() {
  const { refresh } = useSession();
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [accepts, setAccepts] = useState<string[]>([]);
  const [second, setSecond] = useState<'totp' | 'recovery' | 'email_code' | 'password'>('totp');
  const [recovery, setRecovery] = useState('');
  const [run, busy, error, clear] = useAction();

  const after = async (r: { next: string; accepts?: string[] }) => {
    setCode('');
    if (r.next === 'two_step') {
      setAccepts(r.accepts ?? []);
      setSecond((r.accepts ?? [])[0] === 'email_code' ? 'password' : 'totp');
      setStep('two_step');
    } else {
      await refresh();
      navigate('/', true);
    }
  };
  const go = (s: Step) => {
    clear();
    setCode('');
    setStep(s);
  };

  if (step === 'email_code' || step === 'authenticator') {
    const viaApp = step === 'authenticator';
    return (
      <>
        <Header title={viaApp ? 'Authenticator code' : 'Check your email'} sub={viaApp ? 'Step 1' : 'Step 2 of 2'} onBack={() => go('start')} />
        <main className="screen" style={{ gap: 16 }}>
          <span style={{ alignSelf: 'center' }}><Mascot size={96} bob /></span>
          <div className="stack"><h2 className="display h1">Enter the 6-digit code</h2><p className="small" style={{ fontSize: 15 }}>{viaApp ? 'From your authenticator app.' : `Sent to ${email}.`}</p></div>
          <Codes length={6} value={code} onChange={setCode} label="6-digit code" />
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <Btn busy={busy} disabled={code.length !== 6} onClick={() => run(async () => after(await api('POST', viaApp ? '/auth/authenticator' : '/auth/email-code/verify', { email, code })))}>Sign in</Btn>
            {!viaApp && <Btn kind="second" onClick={() => run(() => api('POST', '/auth/email-code', { email }))}>Send a new code</Btn>}
          </div>
        </main>
      </>
    );
  }

  if (step === 'two_step') {
    const body = second === 'totp' ? { code } : second === 'recovery' ? { recovery } : second === 'email_code' ? { emailCode: code } : { password };
    const ready = second === 'recovery' ? recovery.length >= 8 : second === 'password' ? password.length > 0 : code.length === 6;
    return (
      <>
        <Header title="Two-step verification" sub="Last step" onBack={() => go('start')} />
        <main className="screen" style={{ gap: 16 }}>
          {second === 'totp' && <><h2 className="display h1">Authenticator code</h2><Codes length={6} value={code} onChange={setCode} label="Authenticator code" /></>}
          {second === 'recovery' && <><h2 className="display h1">Recovery code</h2><Field label="Recovery code" value={recovery} onChange={setRecovery} autoComplete="off" /></>}
          {second === 'email_code' && <><div className="stack"><h2 className="display h1">Check your email</h2><p className="small" style={{ fontSize: 15 }}>Sent to {email}.</p></div><Codes length={6} value={code} onChange={setCode} label="Emailed code" /></>}
          {second === 'password' && <><h2 className="display h1">Password</h2><Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" /></>}
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <Btn busy={busy} disabled={!ready} onClick={() => run(async () => after(await api('POST', '/auth/two-step', body)))}>Verify</Btn>
            {accepts.includes('recovery') && <Btn kind="second" onClick={() => { clear(); setSecond(second === 'recovery' ? 'totp' : 'recovery'); }}>{second === 'recovery' ? 'Use my authenticator' : 'Use a recovery code'}</Btn>}
            {accepts.includes('email_code') && <Btn kind="second" onClick={() => run(async () => { if (second === 'password') { await api('POST', '/auth/two-step/email-code'); setCode(''); setSecond('email_code'); } else setSecond('password'); })}>{second === 'password' ? 'Email me a code' : 'Use my password'}</Btn>}
          </div>
        </main>
      </>
    );
  }

  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  return (
    <main className="screen" style={{ padding: '20px 20px 24px', gap: 14 }}>
      <div className="grow stack center" style={{ alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Mascot size={110} full bob label="Zorion the black pig" />
        <div className="display" style={{ fontSize: 44 }}>Zorion</div>
        <p style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 15 }}>Good fortune, fair walk.</p>
      </div>
      <h1 className="display h1">Host a meetup</h1>
      <Seg value={method} onChange={(m) => { clear(); setMethod(m); }} options={[{ value: 'code', label: 'Email code' }, { value: 'password', label: 'Password' }]} />
      <Field label="Email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={setEmail} />
      {method === 'password' && <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />}
      <Oops>{error}</Oops>
      {method === 'code' ? (
        <>
          <Btn busy={busy} disabled={!valid} onClick={() => run(async () => { await api('POST', '/auth/email-code', { email }); go('email_code'); })}>Email me a code</Btn>
          <Btn kind="text" disabled={!valid} onClick={() => go('authenticator')}>Use my authenticator</Btn>
          <p className="small center">New? This creates your account.</p>
        </>
      ) : (
        <>
          <Btn busy={busy} disabled={!valid || !password} onClick={() => run(async () => after(await api('POST', '/auth/password', { email, password })))}>Sign in</Btn>
        </>
      )}
      <p className="small center">Got a meetup link? Just open it. No account needed.</p>
      <p className="small center"><a href="/api/legal/terms" target="_blank" rel="noopener">Terms</a> · <a href="/api/legal/privacy" target="_blank" rel="noopener">Privacy</a></p>
    </main>
  );
}
