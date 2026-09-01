# mocksmith

A session-aware mock server for front-end development and end-to-end tests.

One server speaks **HTTP/HTTPS, WebSocket, raw TCP/TLS and SSE**, keeps an isolated
data session per browser or per test, and can be reshaped at runtime — patch the
data, break an endpoint, apply a scenario, push a websocket event — without a
restart.

```bash
npm install --save-dev mocksmith
```

> Not published to npm yet. Until then, install from a git checkout or a local
> tarball (`npm pack`).

## Why

Most mocking tools intercept HTTP in the browser or match single requests. This
one models **the state of a world** and serves every transport an app talks to
from that one state:

- **One session, many transports.** A REST call, a websocket subscription and an
  SSE stream all read the same session data. An HTTP mock can push a message
  into that session's open sockets.
- **Real isolation.** Each browser (cookie) or bearer token gets its own session;
  the Playwright fixture creates one per test, so parallel tests never collide.
- **Scenarios as data.** A situation ("the feed is slow, then fails") is a
  declarative file, not test code — shared by e2e tests and manual QA.
- **Runtime control.** A REST API and a CLI reshape a running server, so you can
  reproduce a bug without touching source or restarting anything.

## Quick start

Describe the world and the endpoints that read it:

```ts
// mocksmith.config.ts
import { defineMockerConfig } from 'mocksmith/config';

export default defineMockerConfig({
  server: { host: '127.0.0.1', port: 3101 },
  defaultSessionData: {
    user: { name: 'Ada', plan: 'pro' },
    items: [{ id: 1, title: 'Anvil', price: 120 }],
  },
  handlers: [
    {
      '/api/profile': (api) => ({ response: { body: api.user } }),
      '/api/items': (api) => ({ response: { body: { items: api.items } } }),
    },
  ],
});
```

Start it:

```bash
npx mocksmith start --config ./mocksmith.config.ts
# 🔨 mocksmith is up: http://127.0.0.1:3101
curl http://127.0.0.1:3101/api/profile   # {"name":"Ada","plan":"pro"}
```

Change it while it runs:

```bash
npx mocksmith session set user.plan '"free"'
npx mocksmith endpoint set /api/items --status 503 --delay 2000
npx mocksmith endpoint clear --all
npx mocksmith session reset
```

## Handlers

A handler receives the session data and returns a response. It may also push a
message into the websockets of the same session:

```ts
import type { MockFunction } from 'mocksmith';

const notify: MockFunction<ShopApi> = (api, { requestData }, sendToWebSocket) => {
  sendToWebSocket({ type: 'notification', text: `Hello, ${api.user.name}!` });

  return { response: { status: 202, body: { sent: true } } };
};
```

Handlers can be inline objects, or paths to modules that the config loads —
TypeScript included, no loader registration required.

## Scenarios

A scenario is the starting state plus response overrides. Overrides support a
status, a body, headers, a delay, a dropped connection, query conditions, and a
**sequence of responses answered by call number** (the last one repeats):

```ts
// degraded.scenario.ts
import { defineScenario } from 'mocksmith/scenario';

export default defineScenario({
  name: 'Degraded shop',
  description: 'Items time out once, then keep failing.',
  session: {
    patch: { user: { plan: 'free' } },
    flags: { NEW_CHECKOUT: true },
  },
  endpoints: [
    {
      path: '/api/items',
      responses: [
        { status: 200, delay: 300, body: { items: [] } },
        { status: 503, body: { error: 'items unavailable' } },
      ],
    },
    { path: '/api/profile', when: { query: { verbose: 1 } }, abort: true },
  ],
});
```

```bash
npx mocksmith scenario apply ./degraded.scenario.ts
npx mocksmith scenario clear
```

## Playwright

`mockTest` gives each test its own session and cleans it up afterwards:

```ts
import { expect } from '@playwright/test';
import { applyScenario, mockTest } from 'mocksmith/playwright';

import scenario from './degraded.scenario';
import session from './session';

mockTest('items degrade under load', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, scenario);

  expect((await page.request.get('/api/items')).status()).toBe(200);
  expect((await page.request.get('/api/items')).status()).toBe(503);
});
```

Point the fixture at the server with `MOCKSMITH_URI=http://127.0.0.1:3101`.
External requests are blocked by default, and images are answered with a
placeholder so tests never depend on the network.

## Vite

Start the mock server together with the dev server, reload the browser on
demand, and hand out non-colliding ports to parallel dev sessions:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from 'mocksmith/vite';

const env = await getMockPortsEnv();

export default defineConfig({
  server: { port: Number(env.PORT) },
  plugins: [
    startProcessAndWaitPlugin({
      name: 'mocksmith',
      command: 'npx',
      args: ['mocksmith', 'start', '--config', './mocksmith.config.ts'],
      healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,
      env,
    }),
    mockReloadPlugin(),
  ],
});
```

`mockReloadPlugin` is what makes `mocksmith reload` (and `scenario apply`)
refresh the open browser.

## Runtime API

Everything the CLI does is a `POST` to the server, so any tool can drive it:

| Endpoint | Purpose |
| --- | --- |
| `/__mocks/api/createSession` · `clearSession` | create / drop a session (optionally token-bound) |
| `/__mocks/api/getSession` · `patchSession` · `resetSession` | read, deep-merge, roll back session data |
| `/__mocks/api/setOverride` · `clearOverride` · `getOverrides` | endpoint override rules |
| `/__mocks/api/sendToWebsocket` | push a message into a session's sockets |
| `/__mocks/api/websockets/state` · `websockets/close` | inspect connections, simulate disconnects |
| `/__healthcheck` | readiness probe |

## Custom protocols

Two hooks cover binary or otherwise non-JSON transports:

```ts
export default defineMockerConfig({
  // ...
  websocket: {
    encodeMessage: (messages) => encodeMyProtocol(messages),
    echoSubprotocols: ['my-client.native'],
  },
  rawSockets: {
    handler: './rawSocketHandler.ts',
    greetingHex: '0102',
    routes: [{ path: '/feed', port: 3201, secure: true }],
  },
});
```

Raw TCP/TLS routes share sessions and handlers with the HTTP server, so a native
client and a browser can talk to the same mocked world.

## Lint rule

Keep scenario files declarative — imports and scenario definitions only, with
case constants living next to the test:

```js
// eslint.config.js
import mocksmith from 'mocksmith/eslint';

export default [
  {
    files: ['**/*.scenario.ts'],
    plugins: { mocksmith },
    rules: { 'mocksmith/scenario-file-purity': 'error' },
  },
];
```

## Entry points

| Import | Contents |
| --- | --- |
| `mocksmith` | `createMockServer`, `MockContext`, `sessions`, types |
| `mocksmith/config` | `defineMockerConfig`, `loadMockerConfig`, `startMockerFromConfig` |
| `mocksmith/scenario` | `defineScenario`, `defineTestScenario`, `loadScenario`, `applyScenarioViaApi` |
| `mocksmith/playwright` | `mockTest`, `applyScenario` (peer: `@playwright/test`) |
| `mocksmith/vite` | `startProcessAndWaitPlugin`, `mockReloadPlugin`, `getMockPortsEnv` (peer: `vite`) |
| `mocksmith/eslint` | `scenario-file-purity` (peer: `eslint`) |

Playwright, Vite and ESLint are optional peers — none of them is pulled in
unless you import the matching entry point.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `MOCKSMITH_PORT` | default server port (3001) |
| `MOCKSMITH_URI` | server URI used by the Playwright fixture |
| `MOCKSMITH_APP_URI` | app URI used by `reload` |
| `MOCKSMITH_LOG_LEVEL` | `trace` … `error` (default `info`) |
| `MOCKSMITH_CONFIG` | default `--config` value |
| `MOCKSMITH_SESSION_ID` | default `--session` value |

## Example

`examples/basic` is a runnable example covering HTTP, websockets, SSE and
scenarios, with a smoke script that exercises them against the packed package:

```bash
npm run build && npm pack
cd examples/basic && npm install ../mocksmith-0.1.0.tgz && npm run smoke
```

## Requirements

Node.js 20.19 or newer. ESM only.

## Provenance

Extracted and generalised from an internal mock server used to develop and test
several production front-ends. All domain-specific protocol code, reference data
and endpoint fixtures were left behind; what remains is the transport-agnostic
engine.

## License

MIT
