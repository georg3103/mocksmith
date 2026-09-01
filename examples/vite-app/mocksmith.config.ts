import { scenarios } from '@mocksmith/scenarios/plugin';
import { defineMockerConfig } from 'mocksmith/config';

import handlers from './handlers';
import session from './session';
import sseHandlers from './sseHandlers';
import websocketHandlers from './websocketHandlers';

/**
 * No `server.port` here on purpose: the Vite plugin reserves a free port pair
 * and passes it through MOCKSMITH_PORT, which fills in when the config names
 * none. Running `mocksmith start` on its own falls back to the default 3001.
 *
 * The host stays `localhost` to match the app's origin — cookies treat
 * `localhost` and `127.0.0.1` as different hosts, and the test fixture binds
 * the session cookie to the app origin.
 * */
export default defineMockerConfig({
  server: { host: 'localhost' },
  handlers: [handlers],
  defaultSessionData: session,
  websocketHandlers,
  sseHandlers,
  plugins: [scenarios({ dir: '.' })],
  client: { sessionId: 'default', appUrl: process.env.MOCKSMITH_APP_URI },
});
