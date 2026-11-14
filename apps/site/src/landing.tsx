import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { CityPlan } from './cityplan';
import { ART, DEFAULT_PLANS, ICONS, type Plans, TRAVEL_LABEL, formatPrice } from '@zorion/core';

// The landing page, built to the approved mockup: a map where everyone's route meets in the middle,
// three map scenes with a card each, the Pro table (from the plans set in the admin portal) and a pink close.

const art = (inner: string, viewBox: string, w: number, h: number, label?: string) => (
  <svg viewBox={viewBox} width={w} height={h} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: inner }} />
);
const Head = ({ size }: { size: number }) => art(ART.headChef!, '-6 -14 132 126', size, Math.round(size * 126 / 132));
const Pig = ({ w, star, label }: { w: number; star?: boolean; label: string }) => art(star ? ART.fullStarRim! : ART.fullChef!, '0 -22 240 254', w, Math.round(w * 254 / 240), label);
const Food = ({ name, size }: { name: string; size: number }) => art(ICONS[name] ?? ICONS.star!, '0 0 24 24', size, size);
const Tick = () => <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** The drawn streets behind every scene. */
function Streets({ w, h, dark }: { w: number; h: number; dark?: boolean }) {
  const k = h / 940;
  return (
    <>
      <rect width={w} height={h} fill={dark ? '#17171b' : '#ececf0'} />
      <path d={`M0 ${808 * k} C360 ${583 * k} 648 ${959 * k} 1008 ${771 * k} S1440 ${489 * k} 1460 ${564 * k}`} fill="none" stroke={dark ? '#18202c' : '#dce6f2'} strokeWidth={80 * k} strokeLinecap="round" />
      <rect x="806" y={94 * k} width="187" height={160 * k} rx="16" fill={dark ? '#1a211b' : '#e1ecdd'} />
      <rect x="173" y={395 * k} width="144" height={122 * k} rx="16" fill={dark ? '#1a211b' : '#e1ecdd'} />
      <path d={`M0 ${216 * k} H1440 M0 ${508 * k} H1440 M0 ${780 * k} H1440 M259 0 V${h} M720 0 V${h} M1181 0 V${h} M1008 0 L490 ${h}`} fill="none" stroke={dark ? '#2a2a31' : '#fff'} strokeWidth="16" strokeLinecap="round" />
    </>
  );
}
const Pins = ({ pins, r, size }: { pins: Array<[number, number, string]>; r: number; size: number }) => (
  <g fontFamily="Rubik Variable, Rubik, sans-serif" fontSize={size} fontWeight="800" textAnchor="middle">
    {pins.map(([x, y, l]) => <g key={l}><circle cx={x} cy={y} r={r} fill="#0b0b0d" /><text x={x} y={y + size * 0.35} fill="#fff">{l}</text></g>)}
  </g>
);
/** Where a floating chip sits: one place on wide screens, another on phones. */
const spot = (x: number, y: number, mx: number, my: number) => ({ '--x': `${x}%`, '--y': `${y}%`, '--mx': `${mx}%`, '--my': `${my}%` }) as CSSProperties;
const routes = (pins: Array<[number, number, string]>, mx: number, my: number) => pins.map(([x, y]) => `M${x} ${y} H${mx} V${my}`).join(' ');

const MOBILE_PINS: Array<[number, number, string]> = [[110, 66, 'M'], [345, 58, 'A'], [40, 241, 'S'], [355, 248, 'L'], [125, 343, 'P'], [270, 339, 'D']];
const MIDDLE_PINS: Array<[number, number, string, string]> = [[640, 120, 'M', 'Maya · 16 min'], [1330, 130, 'J', 'Jonah · 15 min'], [590, 420, 'S', 'Sofia · 15 min'], [1350, 450, 'L', 'Leo · 13 min'], [790, 650, 'P', 'Priya · 16 min'], [1190, 660, 'D', 'Dev · 16 min']];
// [icon, label, desktop x%, y%, phone x%, y%, picked]
const CHIPS: Array<[string, string, number, number, number, number, boolean]> = [['pizza', 'Pizza', 50, 14, 8, 8, true], ['ramen', 'Ramen', 72, 30, 52, 16, true], ['tacos', 'Tacos', 46, 52, 22, 34, true], ['bar', 'Bar', 84, 12, 60, 40, true], ['cocktail', 'Cocktails', 86, 62, 6, 56, false], ['izakaya', 'Izakaya', 64, 76, 50, 62, true]];
const PEOPLE: Array<[string, string, number, number, number, number]> = [['Maya', 'Host', 8, 14, 6, 6], ['Jonah', 'Voted', 30, 28, 50, 14], ['Sofia', 'Voted', 10, 46, 10, 30], ['Leo', 'Voted', 34, 60, 48, 40], ['Priya', 'Choosing', 12, 76, 6, 54], ['Dev', 'Not yet', 40, 84, 46, 66]];

function planRows(p: Plans): Array<[string, string, string]> {
  const yes = (v: boolean) => (v ? 'Yes' : '—');
  const travel = (m: Plans['free']['travel']) => m.map((x) => TRAVEL_LABEL[x]).join(', ');
  const meetups = (n: number) => (n === 0 ? 'No limit' : `${n} at a time`);
  const rows: Array<[string, string, string]> = [
    ['Ads', p.free.ads ? 'Shown' : 'None', p.pro.ads ? 'Shown' : 'None'],
    ['Group size', `Up to ${p.free.groupSize}`, `Up to ${p.pro.groupSize}`],
    ['Meetups', meetups(p.free.activeMeetups), meetups(p.pro.activeMeetups)],
    ['Trip times', travel(p.free.travel), travel(p.pro.travel)],
    ['Own food options', yes(p.free.ownCategories), yes(p.pro.ownCategories)],
    ['Gold theme', yes(p.free.goldTheme), yes(p.pro.goldTheme)],
  ];
  if (p.price.monthly || p.price.yearly) rows.push(['Price', 'S$0', [p.price.monthly && `${formatPrice(p.price.monthly)} / month`, p.price.yearly && `${formatPrice(p.price.yearly)} / year`].filter(Boolean).join(' or ')]);
  return rows;
}

interface Config { appUrl: string; contactEmail: string | null; plans: Plans }

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { fetch('/api/public/config').then((r) => (r.ok ? r.json() : null)).then(setConfig).catch(() => {}); }, []);
  const app = config?.appUrl ?? 'https://zorionapp.midnightpoetry.studio';

  // Smooth scrolling and scroll reveals, loaded after first paint and skipped for reduced motion.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { root.current?.classList.add('still'); return; }
    let stop = () => {};
    let live = true;
    (async () => {
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new Lenis();
      lenis.on('scroll', ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      const ctx = gsap.context(() => {
        gsap.utils.toArray<HTMLElement>('.lp-card').forEach((el) => gsap.fromTo(el, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
        gsap.fromTo('.lp-close .giant', { yPercent: 25 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.lp-close', start: 'top bottom', end: 'bottom bottom', scrub: true } });
      }, root);
      stop = () => { ctx.revert(); gsap.ticker.remove(tick); lenis.destroy(); };
    })().catch(() => root.current?.classList.add('still'));
    return () => { live = false; stop(); };
  }, []);

  // The hero map is one city: drawn flat first (and for reduced motion or no WebGL), then the 3D scene
  // takes over from that exact view, rises into 3D, and settles back to flat as it scrolls away.
  const hero = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const phoneStage = useRef<HTMLDivElement>(null);
  const pig = useRef<HTMLDivElement>(null);
  const phonePig = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let webgl = false;
    try { const c = document.createElement('canvas'); webgl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { webgl = false; }
    if (!webgl) return;
    const phone = matchMedia('(max-width: 760px)');
    let stop = () => {};
    let live = true;
    let run = 0;
    const mount = () => {
      stop();
      stop = () => {};
      hero.current?.classList.remove('is3d');
      const mine = ++run;
      import('./hero3d').then(({ mountHero }) => {
        const box = phone.matches ? phoneStage.current : stage.current;
        if (!live || mine !== run || !box) return;
        const el = hero.current;
        try { stop = mountHero(box, phone.matches ? phonePig.current : pig.current, () => el?.classList.add('is3d')); } catch { el?.classList.remove('is3d'); }
      }).catch(() => {});
    };
    // Wait for the headline to paint first, so the scene never competes with it.
    const timer = window.setTimeout(mount, 350);
    phone.addEventListener('change', mount);
    return () => {
      live = false;
      clearTimeout(timer);
      phone.removeEventListener('change', mount);
      stop();
      hero.current?.classList.remove('is3d');
    };
  }, []);

  const plans = config?.plans ?? DEFAULT_PLANS;
  return (
    <div className="lp" ref={root}>
      {/* ---------- hero ---------- */}
      <section className="lp-hero" ref={hero}>
        <CityPlan className="lp-hero-map" target={pig} />
        <div className="lp-city" ref={stage} />
        <div className="lp-glow" aria-hidden="true" />
        <header className="lp-top">
          <a className="brandmark" href="/"><Head size={44} />Zorion</a>
          <a className="cta dark small" href={app}>Start a meetup</a>
        </header>
        <div className="lp-intro">
          <h1 className="display">{['Meet', 'in', 'the', 'middle.'].map((w, i) => <span key={w} style={{ animationDelay: `${0.1 + i * 0.12}s` }}>{w}</span>)}</h1>
          <p>Good fortune, fair walk. Zorion finds the place that's a fair walk for everyone in your group.</p>
          <a className="cta" href={app}>Start a meetup, free</a>
          <small>Friends join from a link. No sign-up, no app.</small>
          <div className="lp-hero-pig bob" ref={pig}><Pig w={190} label="Zorion the black pig, standing at the middle" /></div>
        </div>
        {/* Phones get the map as its own block under the words, like the mockup. */}
        <div className="lp-hero-mobile">
          <CityPlan className="lp-plan" target={phonePig} />
          <div className="lp-city" ref={phoneStage} />
          <div className="bob" ref={phonePig}><Pig w={130} label="Zorion the black pig" /></div>
        </div>
      </section>

      {/* ---------- you set the ballot ---------- */}
      <section className="lp-scene">
        <svg className="lp-scene-map" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><Streets w={1440} h={640} /></svg>
        <div className="lp-floats" aria-hidden="true">
          {CHIPS.map(([icon, label, x, y, mx, my, on], i) => <div key={label} className={`lp-chip float ${on ? '' : 'off'}`} style={{ ...spot(x, y, mx, my), animationDuration: `${3.2 + i * 0.5}s`, animationDelay: `${i * 0.3}s` }}><Food name={icon} size={28} />{label}{on && <Tick />}</div>)}
        </div>
        <div className="lp-card left">
          <h2 className="display">You set the ballot.</h2>
          <p>Pick up to six food options. Your crew votes on them.</p>
        </div>
      </section>

      {/* ---------- they tap in ---------- */}
      <section className="lp-scene">
        <svg className="lp-scene-map" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><Streets w={1440} h={640} /></svg>
        <div className="lp-floats" aria-hidden="true">
          {PEOPLE.map(([name, status, x, y, mx, my], i) => <div key={name} className="lp-person pop" style={{ ...spot(x, y, mx, my), animationDelay: `${0.2 + i * 0.3}s` }}><span className="av">{name[0]}</span>{name}<small>{status}</small>{status === 'Voted' && <Tick />}{status === 'Choosing' && <i className="dot" />}</div>)}
        </div>
        <div className="lp-card right">
          <h2 className="display">They tap in. No sign-up.</h2>
          <p>Friends open your link, tap their name, reply and share where they're starting from. Each votes for up to half the options.</p>
        </div>
      </section>

      {/* ---------- the fair middle ---------- */}
      <section className="lp-scene tall">
        <svg className="lp-scene-map wide" viewBox="0 0 1440 720" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map: every route leads to the fair middle, with each walk time">
          <Streets w={1440} h={720} />
          <defs><radialGradient id="lpm"><stop offset="0%" stopColor="#ffa6fc" stopOpacity="0.6" /><stop offset="60%" stopColor="#ffa6fc" stopOpacity="0.2" /><stop offset="100%" stopColor="#ffa6fc" stopOpacity="0" /></radialGradient></defs>
          <circle className="pulse" cx="980" cy="370" r="188" fill="url(#lpm)" />
          <path className="dash" d={routes(MIDDLE_PINS.map(([x, y, l]) => [x, y, l]), 980, 370)} fill="none" stroke="#0b0b0d" strokeWidth="4.5" strokeDasharray="7 7" strokeLinecap="round" strokeLinejoin="round" />
          <Pins pins={MIDDLE_PINS.map(([x, y, l]) => [x, y, l])} r={22} size={18} />
          <g fontFamily="Rubik Variable, Rubik, sans-serif" fontSize="18" fontWeight="700" textAnchor="middle" fill="#0b0b0d">{MIDDLE_PINS.map(([x, y, , t]) => <text key={t} x={x} y={y > 600 ? y + 48 : y - 36}>{t}</text>)}</g>
          <circle cx="980" cy="370" r="40" fill="#fff" stroke="#0b0b0d" strokeWidth="2" />
          <g transform="translate(952 343) scale(0.48)" dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
        </svg>
        <svg className="lp-scene-map phone" viewBox="0 0 390 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <Streets w={390} h={380} />
          <circle className="pulse" cx="195" cy="187" r="125" fill="url(#lpm)" />
          <path className="dash" d={routes(MOBILE_PINS, 195, 187)} fill="none" stroke="#0b0b0d" strokeWidth="3" strokeDasharray="7 7" strokeLinecap="round" strokeLinejoin="round" />
          <Pins pins={MOBILE_PINS} r={15} size={12} />
          <circle cx="195" cy="187" r="27" fill="#fff" stroke="#0b0b0d" strokeWidth="2" />
          <g transform="translate(176 169) scale(0.32)" dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
        </svg>
        <div className="lp-card left">
          <h2 className="display">Zorion finds the fair middle.</h2>
          <p>He lists the places closest to everyone. You shortlist, the crew picks one, and the link shows the way there.</p>
          <div className="tags"><span className="t dark">Fiore Pizza</span><span className="t pink">Longest walk 16 min</span><span className="t">Shortest 13 min</span></div>
        </div>
      </section>

      {/* ---------- Pro ---------- */}
      <section className="lp-pro" id="pro">
        <svg className="lp-scene-map" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ opacity: 0.55 }}><Streets w={1440} h={800} dark /></svg>
        <div className="lp-pro-inner">
          <div className="lp-stage">
            <div className="sweep" aria-hidden="true" />
            {[[12, 10, 20], [82, 16, 16], [20, 62, 14], [76, 58, 18]].map(([x, y, s], i) => <svg key={i} className="twinkle" viewBox="0 0 24 24" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${i * 0.3}s` }}><path d="M12 1 L14.6 8.4 L22.5 8.6 L16.2 13.4 L18.5 20.9 L12 16.4 L5.5 20.9 L7.8 13.4 L1.5 8.6 L9.4 8.4 Z" fill="#f5c242" /></svg>)}
            <div className="bob"><Pig w={300} star label="Zorion in gold star sunglasses" /></div>
          </div>
          <div className="lp-pro-copy">
            <h2 className="display">Pro</h2>
            <p>Hosting is free. Pro removes the ads and adds more.</p>
            <div className="lp-table"><table>
              <thead><tr><th scope="col" /><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
              <tbody>{planRows(plans).map(([k, f, p]) => <tr key={k}><th scope="row">{k}</th><td>{f}</td><td>{p}</td></tr>)}</tbody>
            </table></div>
            <div className="lp-btns"><a className="cta gold" href={`${app}/pro`}>Go Pro</a><a className="cta ghost" href={app}>Start free</a></div>
          </div>
        </div>
      </section>

      {/* ---------- how Zorion treats people ---------- */}
      <section className="lp-points">
        {[['Once.', "A starting point is used once, to find the middle. The crew sees walk times, never where anyone is."],
          ['No account.', 'Guests join with their name and a short code.'],
          ['Stripe.', 'Card details go straight to Stripe. Zorion never sees them.'],
          ['Labelled.', 'Ads and sponsored spots are always marked.']].map(([t, d]) => <div key={t}><div className="display">{t}</div><p>{d}</p></div>)}
      </section>

      {/* ---------- close ---------- */}
      <section className="lp-close">
        <div className="bob"><Pig w={180} label="Zorion the black pig" /></div>
        <div className="giant">Zorion</div>
        <a className="cta dark" href={app}>Start a meetup, free</a>
        <nav aria-label="Legal"><span>A Midnight Poetry Studio app</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a>{config?.contactEmail && <a href={`mailto:${config.contactEmail}`}>Contact</a>}</nav>
      </section>
    </div>
  );
}
