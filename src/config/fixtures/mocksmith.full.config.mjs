/**
 * A config exercising every field of MockerConfig. The round-trip test asserts
 * that parseConfig preserves all of them — it rebuilds a fresh literal instead
 * of spreading the input, so a field it forgets is dropped silently.
 */
export default {
  server: { host: '127.0.0.1', port: 3111, rawSockets: true, ssl: true },
  handlers: [{ '/full': { response: { body: { source: 'full' } } } }],
  defaultSessionData: { remoteConfigFlags: { FULL: true } },
  defaultSessionId: 'full-session',
  rewritePath: (path) => `/full${path}`,
  websocketHandlers: [{ path: '/ws', handler: (context) => context }],
  sseHandlers: [{ path: '/sse', handler: () => undefined }],
  websocket: {
    echoSubprotocols: ['full.native'],
    encodeMessage: (messages) => JSON.stringify(messages),
  },
  rawSockets: {
    greetingHex: '0102',
    handler: (context) => context,
    routes: [{ port: 3211, path: '/raw', secure: true }],
    tls: { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' },
  },
  session: {
    cookieName: 'full-session-cookie',
    tokens: { access: 'full-access', refresh: 'full-refresh' },
  },
  ssl: { key: './localhost.key', cert: './localhost.crt' },
  client: { appUrl: 'https://localhost:3000', sessionId: 'full-session', url: 'https://localhost:3111' },
};
