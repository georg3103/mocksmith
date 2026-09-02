<div align="center">

# 🔨 mocksmith

**One mock server for HTTP, WebSocket, raw TCP/TLS and SSE — one isolated
session per browser or per test, reshaped while it runs.**

[![CI](https://github.com/georg3103/mocksmith/actions/workflows/ci.yml/badge.svg)](https://github.com/georg3103/mocksmith/actions/workflows/ci.yml)
[![status](https://img.shields.io/badge/status-pre--release-orange)](#status)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2020.19-brightgreen)](#requirements)
[![module](https://img.shields.io/badge/module-ESM%20only-informational)](#requirements)
[![types](https://img.shields.io/badge/types-included-3178c6)](#requirements)

[Why](#why) · [Quick start](#quick-start) · [Compared to other tools](#compared-to-other-tools) ·
[Docs](docs/how-it-works.md) · [Examples](#examples) · [Contributing](CONTRIBUTING.md)

</div>

<!--
  Once the packages are on the registry, swap the status badge for these:
  [![npm](https://img.shields.io/npm/v/mocksmith)](https://www.npmjs.com/package/mocksmith)
  [![downloads](https://img.shields.io/npm/dm/mocksmith)](https://www.npmjs.com/package/mocksmith)
-->

![The Forge Board — the demo app, with HTTP, WebSocket and SSE all reporting live](docs/media/demo.png)

<div align="center">
  <sub>
    <a href="examples/vite-app">The demo app</a>: every byte comes from mocksmith.
    The list over HTTP, live updates over a websocket, progress over SSE — and a
    log of what actually crossed the wire.
  </sub>
</div>

## Reshape it while it runs

```bash
npx mocksmith start --config ./mocksmith.config.ts
```

Now, without restarting anything and without touching your source:

```bash
npx mocksmith session set user.plan '"free"'         # change the world
npx mocksmith endpoint set /api/items --status 503   # break one endpoint
npx mocksmith endpoint set /api/items --delay 2000   # make it slow
npx mocksmith scenario apply "Degraded shop"         # apply a whole situation
npx mocksmith session reset                          # put it all back
```

Every browser tab and every parallel test has its **own** copy of that world, so
one test's 503 is invisible to the next.

## Status

Working, tested — 140 tests, three CI jobs, a browser suite driving a real app —
and **not on npm yet**. Until the first release, install from a git checkout or
from local tarballs:

```bash
git clone https://github.com/georg3103/mocksmith.git && cd mocksmith
pnpm install && pnpm run build
pnpm -r --filter './packages/*' pack --pack-destination /tmp/tarballs
```

After the first publish, this is all it takes:

```bash
npm install --save-dev mocksmith
```

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

For the full picture — the request lifecycle, sessions, the startup sequence,
and how the pieces fit — see [docs/how-it-works.md](docs/how-it-works.md).

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

From here the server is yours to reshape while it runs — `session set`,
`endpoint set`, `scenario apply`, `reload`, `session reset`. Every one of those
is a REST call underneath, so a test or a script can do the same thing without
the CLI: see [Runtime API](#runtime-api).

## Compared to other tools

Different tools solve different halves of the problem. mocksmith is a **server**,
so anything that can open a socket can talk to it, and the state lives in the
server rather than in your test file.

| | mocksmith | [MSW](https://mswjs.io) | [json-server](https://github.com/typicode/json-server) | [WireMock](https://wiremock.org) |
| --- | --- | --- | --- | --- |
| Runs as | a server | inside the app process | a server | a server (JVM) |
| Transports | HTTP, WS, SSE, raw TCP/TLS | HTTP, WS | HTTP | HTTP |
| Isolated state per test / per tab | built in, cookie- or token-bound | your test's own scope | one shared dataset | via scenario state |
| Reshape a running server | CLI + REST API | from test code | edit the file | REST API |
| Native (non-browser) clients | yes | no | yes | yes |
| Language | TypeScript / Node | TypeScript / Node | Node | Java |

Pick MSW when the app is the only client and you want interception with no
server at all. Pick mocksmith when several clients — a browser, a native app, a
websocket, a parallel Playwright worker — must see one consistent, isolated,
reshapeable world.

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
// vite.config.ts
import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';
import { defineConfig } from 'vite';

const env = await getMockPortsEnv();

export default defineConfig({
  plugins: [
    startProcessAndWaitPlugin({
      name: 'mocksmith',
      command: 'npx',
      args: [
        'mocksmith', 'start',
        '--config', './mocksmith.config.ts',
        '--host', 'localhost',
        '--port', env.MOCKSMITH_PORT,
      ],
      healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,
      env,
    }),
    mockReloadPlugin(),
  ],
  server: {
    port: Number(env.PORT),
    strictPort: true,
    // Same origin for the app and the mocks: the session cookie travels, and
    // no CORS is involved (the mock server sends no CORS headers).
    proxy: {
      '/api': env.MOCKSMITH_URI,
      '/sse': env.MOCKSMITH_URI,
      '/ws': { target: env.MOCKSMITH_URI, ws: true },
    },
  },
});
```

`mockReloadPlugin` is what makes `mocksmith reload` (and `scenario apply`)
refresh the open browser. A full working setup lives in
[`examples/vite-app`](examples/vite-app).

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
| `MOCKSMITH_HOST` | host to bind to when the config names none |
| `MOCKSMITH_PORTS_RESOLVED` | set by `getMockPortsEnv` so a child process does not reserve ports again |
| `MOCKSMITH_SESSION_ID` | default `--session` value |

## Examples

Start with the demo — it is the picture at the top of this page, running:

```bash
git clone https://github.com/georg3103/mocksmith.git && cd mocksmith
pnpm install && pnpm run build
cd examples/vite-app && pnpm dev
```

- [`examples/vite-app`](examples/vite-app) — **The Forge Board**, a React todo
  app served entirely by mocksmith. One command starts the app and the mocks;
  the list travels over HTTP, live updates over a websocket, progress over SSE,
  and the page logs every frame it receives. Scenarios change what it shows;
  Playwright drives it in a real browser.
- [`examples/basic`](examples/basic) — HTTP, websockets, SSE and scenarios, with
  a smoke script that exercises them end to end.
- [`examples/core-only`](examples/core-only) — the core alone, asserting that the
  companion packages are genuinely absent while the server still works.

## Documentation

- [**How it works**](docs/how-it-works.md) — the model, the request path step by
  step, sessions, overrides, transports, the system API, the plugin system, the
  workspace and the release. Written to be read start to finish.
- [Writing a plugin](docs/plugins.md) — the hooks, the system routes, the CLI
  commands a plugin can contribute.
- [Contributing](CONTRIBUTING.md) — how commit messages decide the next version.

## Requirements

Node.js 20.19 or newer. ESM only, TypeScript types included. Configs, handlers
and scenarios can be written in TypeScript with no loader registration —
`jiti` handles that.

## Provenance

Extracted and generalised from an internal mock server used to develop and test
several production front-ends. All domain-specific protocol code, reference data
and endpoint fixtures were left behind; what remains is the transport-agnostic
engine.

## Contributing

Commit messages drive the release: `fix:` cuts a patch, `feat:` a minor, and
every package is published together at one version. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
