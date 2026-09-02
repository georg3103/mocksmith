import { createRoot } from 'react-dom/client';

import { App } from './App';
import './app.css';

/**
 * Deliberately not wrapped in StrictMode.
 *
 * StrictMode double-invokes effects in development, which would fire every
 * request twice — and a scenario that answers "200 first, then 503" would burn
 * both responses on the initial render. That is worth knowing about, but it
 * makes a demo confusing, so this app keeps one effect run per mount.
 * */
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
