import { defineMockerConfig } from 'mocksmith/config';

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
  client: { sessionId: 'default' },
});
