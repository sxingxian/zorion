import type { MapSettings, PlanFeatures, Plans } from '@zorion/core';
import { type AnchorHTMLAttributes, type ReactNode, createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';

// ---------- API ----------
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, any>) {
    super(message);
  }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-zorion': '1' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'offline', 'You seem to be offline. Check your connection and try again.', {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server', data.message ?? 'Something went wrong. Please try again.', data);
  return data as T;
}

/** Runs an action, tracks "busy" and keeps the last error message for display. */
export function useAction(): [run: (fn: () => Promise<unknown>) => Promise<boolean>, busy: boolean, error: string | null, clear: () => void] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy, error, () => setError(null)];
}

// ---------- router (History API, no dependency) ----------
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
};
export function navigate(to: string, replace = false): void {
  if (to === location.pathname && !history.state?.sheet) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((fn) => fn());
  window.scrollTo(0, 0);
}
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || to.startsWith('http')) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------- sheets: Pro and Install open over the current screen ----------
// Each sheet is a history entry, so Back or Close returns to exactly where you were.
export type SheetName = 'pro' | 'install';
const sheetSubs = new Set<() => void>();
const sheetNow = (): SheetName | null => (history.state && typeof history.state === 'object' ? (history.state.sheet as SheetName) ?? null : null);
const onSheetPop = () => sheetSubs.forEach((fn) => fn());
export function openSheet(name: SheetName): void {
  if (sheetNow() === name) return;
  history.pushState({ sheet: name }, '', location.pathname + location.search);
  sheetSubs.forEach((fn) => fn());
}
export function closeSheet(): void {
  if (sheetNow()) history.back();
}
export function useSheet(): SheetName | null {
  return useSyncExternalStore((fn) => {
    sheetSubs.add(fn);
    window.addEventListener('popstate', onSheetPop);
    return () => { sheetSubs.delete(fn); window.removeEventListener('popstate', onSheetPop); };
  }, sheetNow);
}
export const openPro = () => openSheet('pro');

// ---------- install as an app (PWA) ----------
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallPromptEvent | null = null;
const installSubs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; installSubs.forEach((fn) => fn()); });
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('zorion-installed', '1'); } catch { /* fine */ } installSubs.forEach((fn) => fn()); });
}
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** What install looks like here: the browser's own prompt, the iPhone steps, or nothing (already installed). */
export function useInstall() {
  const [, tick] = useState(0);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem('zorion-install-dismissed') === '1'; } catch { return false; } });
  useEffect(() => { const fn = () => tick((n) => n + 1); installSubs.add(fn); return () => { installSubs.delete(fn); }; }, []);
  let installed = false;
  try { installed = standalone() || localStorage.getItem('zorion-installed') === '1'; } catch { installed = standalone(); }
  const ios = isIos() && !installed;
  const can = !installed && (!!deferred || ios);
  return {
    can, ios, installed, dismissed,
    install: async () => {
      if (deferred) { const e = deferred; deferred = null; await e.prompt(); await e.userChoice.catch(() => null); tick((n) => n + 1); }
      else openSheet('install');
    },
    dismiss: () => { try { localStorage.setItem('zorion-install-dismissed', '1'); } catch { /* fine */ } setDismissed(true); },
  };
}

// ---------- signed-in host ----------
export interface Me {
  id: string;
  email: string;
  display_name: string;
  plan: 'free' | 'pro';
  theme: 'gold' | 'pink';
  totp_enabled: boolean;
  has_password: boolean;
  notify: boolean;
  telegram: boolean; // a Telegram chat is connected
  telegram_ready: boolean; // Zorion's bot is set up
  avatar: string; // the pig they picked
  features: PlanFeatures; // what this host's plan includes, as set in the admin portal
}

// ---------- public settings: plans, prices and Google ads ----------
export interface AppConfig { siteOrigin: string; plans: Plans; googleAds: { consent: boolean; placements: string[] } | null; maps?: MapSettings }
let configPromise: Promise<AppConfig | null> | null = null;
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    configPromise ??= api<AppConfig>('GET', '/config').catch(() => { configPromise = null; return null; });
    let live = true;
    configPromise.then((c) => live && setConfig(c));
    return () => { live = false; };
  }, []);
  return config;
}
export const Session = createContext<{ me: Me | null; refresh: () => Promise<void> }>({ me: null, refresh: async () => {} });
export const useSession = () => useContext(Session);

// ---------- light or dark ----------
export type ModeChoice = 'light' | 'dark' | 'auto';
export function useMode(): ['light' | 'dark', ModeChoice, (m: ModeChoice) => void] {
  const [choice, setChoice] = useState<ModeChoice>(() => (localStorage.getItem('zorion-mode') as ModeChoice) ?? 'auto');
  const [system, setSystem] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const set = (m: ModeChoice) => {
    localStorage.setItem('zorion-mode', m);
    setChoice(m);
  };
  return [choice === 'auto' ? (system ? 'dark' : 'light') : choice, choice, set];
}
export const Look = createContext<{ theme: 'pink' | 'gold'; mode: 'light' | 'dark' }>({ theme: 'pink', mode: 'light' });

// ---------- dates ----------
export function when(iso: string | null, timeZone: string): string {
  if (!iso) return 'Date to be voted';
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
  const ymd = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(x);
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const label = ymd(d) === today ? (d.getHours() >= 17 || Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false }).format(d)) >= 17 ? 'Tonight' : 'Today') : ymd(d) === tomorrow ? 'Tomorrow' : day;
  return `${label}, ${time}`;
}
/** Value for <input type="datetime-local"> in the device's own time zone, and back. */
export const toLocalInput = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const fromLocalInput = (v: string): string | null => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
