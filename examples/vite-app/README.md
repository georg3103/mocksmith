# mocksmith vite example

A small React app served by Vite, with every request answered by mocksmith.

One command starts both:

```bash
pnpm dev
```

The Vite plugin reserves a free port pair, starts the mock server, waits for its
healthcheck, and proxies `/api`, `/sse` and `/ws` to it — so the app and the
mocks share an origin and the session cookie travels with every request.

Change what the app sees while it is running:

```bash
npx mocksmith --config ./mocksmith.config.ts scenario list
npx mocksmith --config ./mocksmith.config.ts scenario apply "Degraded shop"
npx mocksmith --config ./mocksmith.config.ts session set user.plan '"free"'
```

The page reloads by itself: `mockReloadPlugin` turns the CLI's request into a
Vite HMR full reload.

Browser tests, each in its own mock session:

```bash
pnpm test:e2e
```

They use the Chrome already installed on your machine. Set `PLAYWRIGHT_CHANNEL`
to pick a different browser channel.

## Worth knowing

- `main.tsx` does not use `StrictMode`. It double-invokes effects in
  development, which fires every request twice — a scenario answering "200
  first, then 503" would burn both responses on the first render.
- The mock server has no CORS headers, which is why the app talks to it through
  the Vite proxy rather than a second origin.
