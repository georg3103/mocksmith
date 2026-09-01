import { defineMockerConfig } from '../defineMockerConfig';

export default defineMockerConfig({
  server: { port: 3103, rawSockets: true, ssl: true },
  handlers: [
    {
      '/inline-ts': {
        response: {
          body: { source: 'ts' },
        },
      },
    },
  ],
  defaultSessionData: {
    remoteConfigFlags: {
      TS_CONFIG: true,
    },
  },
  session: {
    cookieName: 'test-session',
    tokens: {
      access: 'test-access-token',
      refresh: 'test-refresh-token',
    },
  },
  rewritePath: (path) => `/mobile${path}`,
  rawSockets: {
    greetingHex: '0102',
    handler: (context) => context,
    routes: [{ port: 3201, path: '/socket', secure: true }],
    tls: { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' },
  },
  client: { sessionId: 'ts-session' },
});
