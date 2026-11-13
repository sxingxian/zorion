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
          <div className="stack"><h2 className="display h1">Enter the 6-digit code</h2><p className="small" style={{ fontSize: 15 }}>{viaApp ? `From your authenticator app, for ${email}.` : `Sent to ${email}. It works once and expires in 10 minutes.`}</p></div>
          <Codes length={6} value={code} onChange={setCode} label="6-digit code" />
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <p className="small center">Five wrong tries pauses sign-in for 15 minutes.</p>
            <Btn busy={busy} disabled={code.length !== 6} onClick={() => run(async () => after(await api('POST', viaApp ? '/auth/authenticator' : '/auth/email-code/verify', { email, code })))}>Verify and sign in</Btn>
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
          <Note ok>First step accepted</Note>
          {second === 'totp' && <><div className="stack"><h2 className="display h1">Enter your authenticator code</h2><p className="small" style={{ fontSize: 15 }}>Open your authenticator app and type the 6-digit code for Zorion.</p></div><Codes length={6} value={code} onChange={setCode} label="Authenticator code" /></>}
          {second === 'recovery' && <><h2 className="display h1">Enter a recovery code</h2><Field label="Recovery code" value={recovery} onChange={setRecovery} autoComplete="off" /></>}
          {second === 'email_code' && <><div className="stack"><h2 className="display h1">Enter the emailed code</h2><p className="small" style={{ fontSize: 15 }}>You used your authenticator first, so the last step is a code sent to {email}.</p></div><Codes length={6} value={code} onChange={setCode} label="Emailed code" /></>}
          {second === 'password' && <><div className="stack"><h2 className="display h1">Enter your password</h2><p className="small" style={{ fontSize: 15 }}>You used your authenticator first, so the last step is a different proof.</p></div><Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" /></>}
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <Btn busy={busy} disabled={!ready} onClick={() => run(async () => after(await api('POST', '/auth/two-step', body)))}>Verify</Btn>
            {accepts.includes('recovery') && <Btn kind="second" onClick={() => { clear(); setSecond(second === 'recovery' ? 'totp' : 'recovery'); }}>{second === 'recovery' ? 'Use my authenticator' : 'Use a recovery code'}</Btn>}
            {accepts.includes('email_code') && <Btn kind="second" onClick={() => run(async () => { if (second === 'password') { await api('POST', '/auth/two-step/email-code'); setCode(''); setSecond('email_code'); } else setSecond('password'); })}>{second === 'password' ? 'Email me a code instead' : 'Use my password instead'}</Btn>}
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
          <Btn busy={busy} disabled={!valid} onClick={() => run(async () => { await api('POST', '/auth/email-code', { email }); go('email_code'); })}>Send me a 6-digit code</Btn>
          <Btn kind="text" disabled={!valid} onClick={() => go('authenticator')}>Use my authenticator app instead</Btn>
          <p className="small center">New here? The same code creates your account.</p>
        </>
      ) : (
        <>
          <Btn busy={busy} disabled={!valid || !password} onClick={() => run(async () => after(await api('POST', '/auth/password', { email, password })))}>Sign in</Btn>
          <p className="small center">If two-step verification is on, your code is the last step.</p>
        </>
      )}
      <Note ok>Joining a friend's meetup? You don't need an account. Just open their link.</Note>
      <p className="small center">By continuing you agree to the <a href="/api/legal/terms" target="_blank" rel="noopener">terms</a> and <a href="/api/legal/privacy" target="_blank" rel="noopener">privacy notice</a>.</p>
    </main>
  );
}
