import type { ReactNode } from 'react';
import { ART } from '@zorion/core';

/** Zorion's own error page: missing pages, expired links and a server that can't be reached. */
export function ErrorPage({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="signin">
      <div className="errpage" role="alert">
        <svg viewBox="-6 -14 132 126" width={96} height={92} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
        <h1 className="display">{title}</h1>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}
