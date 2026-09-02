# Changelog

## [0.3.1](https://github.com/georg3103/mocksmith/compare/v0.3.0...v0.3.1) (2026-09-02)


### Bug Fixes

* verify a release is actually public before calling it done ([fbe4721](https://github.com/georg3103/mocksmith/commit/fbe47215ce3fe1b7b22fe9cbc6bb8f40b71ccedc))

# [0.3.0](https://github.com/georg3103/mocksmith/compare/v0.2.0...v0.3.0) (2026-09-02)


### Bug Fixes

* accept handlers typed against a project's own session shape ([d6d5d1b](https://github.com/georg3103/mocksmith/commit/d6d5d1b7381034587eff5bad0205072a022aa518))
* install the example tarballs in one command, without peer resolution ([cb5fec8](https://github.com/georg3103/mocksmith/commit/cb5fec8887edb9a497e943ec51ff358626545f86))
* repair what the first CI run exposed ([927b2e1](https://github.com/georg3103/mocksmith/commit/927b2e193483dc9d6ec82a71267e704459e403f1))


### Features

* rebuild the browser demo as a live todo board ([d7bebeb](https://github.com/georg3103/mocksmith/commit/d7bebeb5b1378f8046248a71ad71027cdb74f45c))

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
