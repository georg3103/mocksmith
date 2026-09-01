import { defineMockerConfig } from 'mocksmith/config';

import handlers from './handlers';

/**
 * The core on its own: no plugins, no companion packages. Everything this
 * config uses — mock handlers, sessions, endpoint overrides — lives in
 * `mocksmith` itself.
 * */
export default defineMockerConfig({
  server: { host: '127.0.0.1', port: 3102 },
  handlers: [handlers],
  defaultSessionData: { user: { name: 'Ada', plan: 'pro' } },
  client: { sessionId: 'default' },
});
