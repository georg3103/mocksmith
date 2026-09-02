# The Forge Board — a mocksmith demo

A small React todo app where **every** byte comes from mocksmith: the list over
HTTP, live updates over a websocket, progress over SSE. Open it and you can see
all three transports reporting for themselves at the top of the page.

```bash
pnpm dev
```

One command starts the app and the mock server. The Vite plugin reserves a free
port pair, starts `mocksmith`, waits for its healthcheck and proxies `/api`,
`/sse` and `/ws` to it — so the app and the mocks share an origin and the
session cookie travels with every request.

## What each transport does here

| Transport | In this app |
| --- | --- |
| **HTTP** | `GET /api/board`, `GET/POST /api/todos`, `PATCH/DELETE /api/todos/:id`. Handlers read and write the session, so a task you add is really stored. |
| **WebSocket** | The page sends `ping` and gets a `pong` (the round trip is alive), and every mutation handler pushes the new list into the session's sockets — open a second tab and watch it follow along without a reload. |
| **SSE** | `/sse/progress` streams `done/total` once a second, read straight from the session. Nothing on the page asks for it. |

Handlers are keyed by path only — the method is read from the request itself
(`handlers.ts`), and `:id` arrives in `requestData.urlParams`.

## Seeing it happen

The page keeps its own log — **what crossed the wire** — with one line per HTTP
call, per websocket frame (`↑ ping`, `↓ pong`, `↓ todos`) and per change on the
stream. The SSE card counts beats, so a number that keeps growing is the
liveness signal. Nothing has to be inspected to believe the demo.

Chrome's DevTools show the same thing, with two catches that make people think
the sockets are missing:

- **A websocket is only recorded while DevTools is open.** It is opened once, on
  page load, so open DevTools *first* and reload. Then it appears under the
  **Socket** (older Chrome: **WS**) filter as `ws`, and its frames are in the
  **Messages** tab of that entry — not as separate rows in the list.
- **SSE is one request, not one per event.** `/sse/progress` stays in the list
  as a single pending row; the events are in its **EventStream** tab.

To watch it from outside the browser instead:

```bash
# who is connected right now
curl -s -X POST http://localhost:3001/__mocks/api/websockets/state \
  -H 'content-type: application/json' -d '{"id":"default"}'

# push a frame into every socket of the session — the page changes with no request
curl -s -X POST http://localhost:3001/__mocks/api/sendToWebsocket \
  -H 'content-type: application/json' \
  -d '{"id":"default","data":{"data":{"type":"todos","todos":[{"id":1,"title":"Pushed from curl","done":false}]}}}'

# the stream, in the terminal
curl -N http://localhost:3001/sse/progress
```

The push changes the *page*, not the world — the session still holds the real
list, and a reload brings it back. That is the difference between a message and
a mutation.

## Reshape it while it runs

The commands are printed at the bottom of the page with the ports of your
running server already filled in. From `examples/vite-app`:

```bash
export MOCKSMITH_URI=http://localhost:<mock port> MOCKSMITH_APP_URI=http://localhost:<app port>

npx mocksmith -c ./mocksmith.config.ts scenario list
npx mocksmith -c ./mocksmith.config.ts scenario apply "Flaky board"
npx mocksmith -c ./mocksmith.config.ts session set user.plan '"free"'
npx mocksmith -c ./mocksmith.config.ts endpoint set /api/board --status 503
npx mocksmith -c ./mocksmith.config.ts session reset
```

`scenario apply` reloads the open page by itself: `mockReloadPlugin` turns the
CLI's request into a Vite full reload.

Worth watching once: with `Flaky board` applied, the list goes empty while the
SSE strip still says `1/3 done`. That is not a bug — an endpoint override
changes an *answer*, not the world behind it, and the stream reads the world.

## Browser tests

```bash
pnpm test:e2e
```

Each test gets its own mock session, so they run in parallel without colliding.
They use the Chrome already installed on your machine; set `PLAYWRIGHT_CHANNEL`
to pick a different channel.

```bash
pnpm typecheck   # the demo is typechecked too, against the built packages
```

## Losing the server, and finding it again

Stop the mock server while the page is open and the strip tells you honestly:
HTTP goes red, the websocket says `reconnecting…`, the stream says `closed`.
Start it again and the page recovers on its own — the socket reopens with a
backoff, and on reconnect it refetches the board, because the world may have
moved on while it was blind.

That behaviour is in `App.tsx`, and two details there are worth stealing:

- **A websocket does not reconnect by itself.** `EventSource` does; `WebSocket`
  does not. Reconnecting is your job, and a backoff (1s, 2s, 4s, capped at 8s)
  keeps a dead server from becoming a busy loop.
- **A stalled SSE stream does not look like an error.** When the mock server
  dies behind the dev server's proxy, the browser is not told: the connection
  stays open and simply goes quiet, so no `error` event arrives and a naive
  indicator stays green over a dead stream. The stream beats once a second, so
  silence longer than five seconds is the signal — the page treats it as one and
  reopens.

## Worth knowing

- `main.tsx` does not use `StrictMode`. It double-invokes effects in
  development, which fires every request twice — a scenario answering "200
  first, then 503" would burn both responses on the first render.
- The mock server sends no CORS headers, which is why the app talks to it
  through the Vite proxy rather than a second origin.
- The host is `localhost` everywhere. Cookies treat `localhost` and `127.0.0.1`
  as different hosts, so mixing them makes session isolation fail silently.
