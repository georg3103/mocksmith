# Changelog

## 0.2.0

Split into a core plus opt-in companion packages, and added a plugin system.

**Breaking.** The single `mocksmith` package with subpath exports is now five
packages. Nothing was published before this release, so no migration is
required — but the import paths differ from the pre-release layout:

| Was | Now |
| --- | --- |
| `mocksmith/scenario` | `@mocksmith/scenarios` (+ `/plugin`, `/playwright`) |
| `mocksmith/playwright` | `@mocksmith/playwright` |
| `mocksmith/vite` | `@mocksmith/vite` |
| `mocksmith/eslint` | `@mocksmith/eslint-plugin` |
| `applyScenario` from `mocksmith/playwright` | `@mocksmith/scenarios/playwright` |

Scenario support now requires registering the plugin:
`plugins: [scenarios({ dir: './mocks' })]`.

### Added

- A plugin API (`mocksmith/plugin`): lifecycle hooks (`config`, `setup`,
  `serverStarted`, `sessionCreated`, `close`), contributed mock handlers, system
  routes, SSE and websocket handlers, session-data patches, and CLI commands
  declared as data so a plugin never depends on commander.
- `ctx.callSystemApi` — in-process calls to the system API with the same
  signature the CLI uses over HTTP, so one implementation serves every transport.
- `mocksmith/client` — the runtime-free surface (cookie name, image stub, shared
  types) for companion packages and test workers.
- Scenarios are addressable by name: `scenario list`, `scenario apply <name>`,
  and `applyScenario(page, 'name')`. A file path still works.
- `plugins` and `pluginDiscovery` config options, plus schema entries for them.
- `CONTEXT_COOKIE_NAME` is now public, instead of being reached for internally.

### Fixed

- A websocket upgrade to an unregistered path left the socket open until it timed
  out; it is now closed immediately.
- `/__mocks/api/addHandler` was a stub that returned `undefined` and therefore
  answered 404. Removed.

### Changed

- `MockFunctionIncomingParams.request` is optional, so an in-process call is
  honest about having no HTTP request rather than faking one.

## 0.1.0

First release.

- Mock server over HTTP/HTTPS, WebSocket, raw TCP/TLS and SSE, sharing one session state.
- Sessions resolved by cookie, bearer token or an issued session key, with a permissive local mode.
- Declarative scenarios: session patch plus endpoint overrides (status, body, headers, delay, abort, query conditions, responses by call number).
- Runtime control through `/__mocks/api/*` and the `mocksmith` CLI.
- Playwright fixture with a session per test, plus external-request blocking.
- Vite plugins: mock server autostart with healthcheck, HMR reload endpoint, collision-free port pairs.
- ESLint rule `scenario-file-purity`.
- Pluggable websocket message encoder and configurable echoed subprotocols.
