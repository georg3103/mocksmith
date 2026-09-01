import { defineMockerConfig } from 'mocksmith/config';
import { scenarios } from '@mocksmith/scenarios/plugin';

import handlers from './handlers';
import session from './session';
import sseHandlers from './sseHandlers';
import websocketHandlers from './websocketHandlers';

export default defineMockerConfig({
  server: { host: '127.0.0.1', port: 3101 },
  handlers: [handlers],
  defaultSessionData: session,
  websocketHandlers,
  sseHandlers,
  plugins: [scenarios({ dir: '.' })],
  client: { sessionId: 'default' },
});
