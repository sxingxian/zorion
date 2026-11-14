import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/rubik';
import './site.css';
import { ErrorPage } from './errors';
import { Landing } from './landing';

// The admin portal is a separate chunk, so visitors to the landing page never download it.
const AdminApp = lazy(() => import('./admin'));
const Privacy = lazy(() => import('./legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./legal').then((m) => ({ default: m.Terms })));

function Root() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, '') || '/');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, '') || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  if (path === '/admin' || path.startsWith('/admin/')) {
    return <Suspense fallback={<div className="signin" />}><AdminApp path={path} go={go} /></Suspense>;
  }
  if (path === '/privacy') return <Suspense fallback={null}><Privacy /></Suspense>;
  if (path === '/terms') return <Suspense fallback={null}><Terms /></Suspense>;
  if (path === '/') return <Landing />;
  return <ErrorPage title="Page not found" text="That page isn't here." action={<a className="errbtn" href="/">Go to Zorion</a>} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
