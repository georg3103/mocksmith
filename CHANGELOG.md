# Changelog

## 0.1.0

First release.

- Mock server over HTTP/HTTPS, WebSocket, raw TCP/TLS and SSE, sharing one session state.
- Sessions resolved by cookie, bearer token or an issued session key, with a permissive local mode.
- Declarative scenarios: session patch plus endpoint overrides (status, body, headers, delay, abort, query conditions, responses by call number).
- Runtime control through `/__mocks/api/*` and the `mocksmith` CLI (`start`, `config`, `session`, `endpoint`, `scenario`, `reload`).
- Playwright fixture with a session per test, plus external-request blocking.
- Vite plugins: mock server autostart with healthcheck, HMR reload endpoint, collision-free port pairs.
- ESLint rule `scenario-file-purity`.
- Pluggable websocket message encoder (JSON by default) and configurable echoed subprotocols for custom protocols.
