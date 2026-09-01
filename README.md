# mocksmith

A session-aware mock server for front-end development and end-to-end tests.

One server speaks **HTTP/HTTPS, WebSocket, raw TCP/TLS and SSE**, keeps an
isolated data session per browser or per test, and can be reshaped at runtime —
patch the data, break an endpoint, apply a scenario, push a websocket event —
without a restart.

```bash
npm install --save-dev mocksmith
```

> Not published to npm yet. Until then, install from a git checkout or local
> tarballs (`pnpm -r pack`).

## Install what you use

The core is a mock server and nothing else. Everything optional is a separate
package you opt into, so a project that never writes a scenario never downloads
one:

| Package | Install it when you want |
| --- | --- |
| **`mocksmith`** | the mock server, sessions, endpoint overrides, the config and the CLI |
| **`@mocksmith/scenarios`** | named, declarative scenarios shared by tests and manual QA |
| **`@mocksmith/playwright`** | a fixture giving every test its own mock session |
| **`@mocksmith/vite`** | starting the mock server with the dev server, HMR reload, port allocation |
| **`@mocksmith/eslint-plugin`** | a lint rule keeping scenario files declarative |

Companion packages plug into the core through a documented
[plugin API](docs/plugins.md) — the same one your own packages can use.

## Why

Most mocking tools intercept HTTP in the browser or match single requests. This
one models **the state of a world** and serves every transport an app talks to
from that one state:

- **One session, many transports.** A REST call, a websocket subscription and an
  SSE stream read the same session data. An HTTP mock can push a message into
  that session's open sockets.
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

`npm install --save-dev @mocksmith/scenarios`, then register the plugin:

```ts
import { defineMockerConfig } from 'mocksmith/config';
import { scenarios } from '@mocksmith/scenarios/plugin';

export default defineMockerConfig({
  handlers: [handlers],
  defaultSessionData: session,
  plugins: [scenarios({ dir: './mocks' })],
});
```

A scenario is the starting state plus response overrides. Overrides support a
status, a body, headers, a delay, a dropped connection, query conditions, and a
**sequence of responses answered by call number** (the last one repeats):

```ts
// degraded.scenario.ts
import { defineScenario } from '@mocksmith/scenarios';

export default defineScenario({
  name: 'Degraded shop',
  feature: 'Reliability',
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

The plugin adds a `scenario` command group, and scenarios are addressed by name:

```bash
npx mocksmith scenario list
npx mocksmith scenario apply "Degraded shop"
npx mocksmith scenario apply ./one-off.scenario.ts   # a path still works
npx mocksmith scenario clear
```

## Playwright

`mockTest` gives each test its own session and cleans it up afterwards:

```ts
import { expect } from '@playwright/test';
import { mockTest } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';

mockTest('items degrade under load', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, 'Degraded shop');   // or a scenario object

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
import { defineConfig } from 'vite';
import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';

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

Plugins add their own routes here — `@mocksmith/scenarios` contributes
`scenarios`, `applyScenario` and `clearScenario`.

## Custom protocols

Two hooks cover binary or otherwise non-JSON transports:

```ts
export default defineMockerConfig({
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

## Writing a plugin

The plugin API is public: a plugin can contribute mock handlers, its own system
routes, CLI commands, websocket and SSE handlers, and hook into the server
lifecycle. See [docs/plugins.md](docs/plugins.md).

## Environment variables

| Variable | Meaning |
| --- | --- |
| `MOCKSMITH_PORT` | default server port (3001) |
| `MOCKSMITH_URI` | server URI used by the Playwright fixture |
| `MOCKSMITH_APP_URI` | app URI used by `reload` |
| `MOCKSMITH_LOG_LEVEL` | `trace` … `error` (default `info`) |
| `MOCKSMITH_CONFIG` | default `--config` value |
| `MOCKSMITH_SESSION_ID` | default `--session` value |

## Examples

- [`examples/basic`](examples/basic) — HTTP, websockets, SSE and scenarios, with
  a smoke script that exercises them end to end.
- [`examples/core-only`](examples/core-only) — the core alone, asserting that the
  companion packages are genuinely absent while the server still works.

## Requirements

Node.js 20.19 or newer. ESM only.

## Provenance

Extracted and generalised from an internal mock server used to develop and test
several production front-ends. All domain-specific protocol code, reference data
and endpoint fixtures were left behind; what remains is the transport-agnostic
engine.

## License

MIT
