# mocksmith

A session-aware mock server for HTTP/HTTPS, WebSocket, raw TCP/TLS and SSE.

This is the core package: the server, sessions, endpoint overrides, the typed
config and the `mocksmith` CLI. It has no dependency on any other
`@mocksmith/*` package — scenarios, the Playwright fixture, the Vite plugins and
the lint rule are separate packages you install only if you want them.

```bash
npm install --save-dev mocksmith
```

See the [project README](https://github.com/georg3103/mocksmith#readme) for a
guided tour, and [docs/plugins.md](https://github.com/georg3103/mocksmith/blob/main/docs/plugins.md)
for writing plugins.

## Entry points

| Import | Contents |
| --- | --- |
| `mocksmith` | `createMockServer`, `MockContext`, `sessions`, types |
| `mocksmith/client` | runtime-free surface: cookie name, image stub, shared types |
| `mocksmith/config` | `defineMockerConfig`, `loadMockerConfig`, `startMockerFromConfig` |
| `mocksmith/plugin` | `definePlugin` and the plugin API types |

## License

MIT
