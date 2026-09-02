# How mocksmith works

A complete description of what mocksmith does and how it is built: the model it
asks you to think in, the path a request takes, the startup sequence, the plugin
system, and the way the packages are split.

The README is the tour; this is the map. Where the two disagree, the source wins
— every claim here is meant to be checkable against a file named in the text.

**Contents**

1. [The model](#1-the-model)
2. [Anatomy of a request](#2-anatomy-of-a-request)
3. [Sessions](#3-sessions)
4. [Handlers](#4-handlers)
5. [Overrides](#5-overrides)
6. [Transports](#6-transports)
7. [The system API](#7-the-system-api)
8. [The CLI](#8-the-cli)
9. [The config and how it is loaded](#9-the-config-and-how-it-is-loaded)
10. [Startup, step by step](#10-startup-step-by-step)
11. [Plugins](#11-plugins)
12. [Scenarios](#12-scenarios)
13. [Playwright](#13-playwright)
14. [Vite](#14-vite)
15. [Packages and the workspace](#15-packages-and-the-workspace)
16. [How this is tested](#16-how-this-is-tested)
17. [Constraints and known limits](#17-constraints-and-known-limits)
18. [Environment variables](#18-environment-variables)

---

## 1. The model

This section builds the model from nothing. If you have never used a mock server
before, read it in order — the rest of the document assumes these three words:
**world**, **handler**, **override**.

### 1.1 Start with the obvious mock

The first mock anyone writes is a lookup table: for this URL, return this JSON.

```ts
// the naive version
{
  '/api/profile': { name: 'Ada', plan: 'pro' },
  '/api/items':   { items: [{ id: 1, title: 'Anvil', price: 120 }] },
}
```

This is genuinely fine, and it works for about ten minutes.

### 1.2 The three requests that break it

Everything mocksmith does exists because of these three, which arrive in the
first week of any real project.

**(a) "Show me the same screen for a user without a subscription."**

In a lookup table, `plan` lives inside the profile response. To flip it you edit
that response — and now `/api/billing`, which also mentions the plan, is out of
sync. Two copies of one fact have started drifting. Add a third endpoint and you
are maintaining a small, badly normalised database made of JSON literals.

**(b) "Run ten tests in parallel."**

A lookup table is one shared thing. Test A flips the plan to `free`, test B reads
the profile at the wrong moment and fails. Nothing is broken in the product; the
tests are simply sharing a mutable global. The usual workaround — run tests
sequentially — trades ten minutes of CI for the illusion of isolation.

**(c) "Check what happens when items fail to load."**

You need a 503 for one endpoint, once, right now, and then you need it gone.
Editing the mock file means committing a broken mock, or remembering to revert
it. Neither survives a busy afternoon.

### 1.3 Idea 1 — separate the data from the answers

Instead of storing *answers*, store **the state of the world**, and describe each
endpoint as a **function that reads it**.

```ts
// the world: one plain object, the single source of truth
defaultSessionData: {
  user:  { name: 'Ada', plan: 'pro' },
  items: [{ id: 1, title: 'Anvil', price: 120 }],
},

// handlers: how each endpoint reads that world
handlers: [{
  '/api/profile': (api) => ({ response: { body: api.user } }),
  '/api/items':   (api) => ({ response: { body: { items: api.items } } }),
  '/api/billing': (api) => ({ response: { body: { plan: api.user.plan } } }),
}],
```

The analogy: you no longer keep photographs of a room, you keep **the room**,
plus instructions for taking each photograph. Change the room once and every
photograph changes with it, consistently, for free.

Request (a) is now one line — `user.plan = 'free'` — and all three endpoints
agree, because there is only one place where the plan is written down.

Two names for the rest of the document:

- **the world** — the data object. In the code it is called `apiData`.
- **a handler** — a function from the world to a response.

### 1.4 Idea 2 — give every client its own copy of the world

One world is still one shared thing, so request (b) is unsolved. The fix: the
server keeps **many worlds at once**, and each client gets its own.

That copy is called a **session**. A useful mental image is a savegame: one game,
many independent saves; loading yours does not disturb anyone else's.

```
                    ┌──────────────┐
browser (no cookie) │  world: Ada  │  ← session "default": your manual dev work
                    ├──────────────┤
test #1  cookie=t1  │ world: Grace │  ← its own copy, created before the test
                    ├──────────────┤
test #2  cookie=t2  │  world: Ada  │  ← another copy; both tests run at once
                    └──────────────┘
                       one server
```

The server decides which world to read by looking at the request: a session
cookie, or an `Authorization: Bearer` token, or — when neither is present — the
session named `default`. A test creates its world before it starts and deletes it
afterwards, so ten tests in parallel touch ten separate copies.

A session owns three things: its data, its overrides (next section), and its open
sockets. That last one is why a WebSocket push and a REST response never
disagree — they are reading the same copy.

### 1.5 Idea 3 — temporary distortion on top

Request (c) is not about the world at all. The world is fine; you want one
endpoint to *misbehave* for a while. Changing the handler is the wrong tool: a
handler is code, shared by everyone, and lives in git.

So there is a third layer, checked **before** the handler runs: an **override**.
Think of a sticker placed over one endpoint's answer.

```bash
mocksmith endpoint set /api/items --status 503 --delay 2000
# ... the app now sees a slow failure ...
mocksmith endpoint clear /api/items
```

An override is per session (so it cannot leak into a neighbouring test), it is
removed by one command, and it can do things a handler cannot express cleanly:
drop the connection entirely, delay the answer, or **give a different answer per
call number** — which is how you test a retry that succeeds on the third attempt.

### 1.6 Putting it together

| Layer | Answers the question | Where it lives | Lives for |
| --- | --- | --- | --- |
| **World** (`apiData`) | *what exists* | `defaultSessionData`, or the data a test passes in | until `resetSession` |
| **Handler** | *how an endpoint reads what exists* | your repo — it is code | forever |
| **Override** | *what is pretending to be broken right now* | runtime only, per session | until `clearOverride` |

Reading a request through the model, in one line: **find the session → check for
an override → otherwise run the handler against that session's world.**

That ordering is the one rule worth memorising. It explains the single most
common moment of confusion — an endpoint returning something the handler code
cannot possibly produce — which is almost always an override left behind by an
earlier command or an earlier test.

The practical rule for deciding where to put a change:

- **Durable truth** ("users have a plan") → handlers and `defaultSessionData`.
- **Per-test truth** ("in this test the user is Grace") → session data passed to
  `initMockContext`.
- **Temporary distortion** ("here the feed times out") → an override, or a
  [scenario](#12-scenarios), which is just a named bundle of world-patch plus
  overrides.

### 1.7 Why the same model serves every transport

Because the world belongs to the session and not to the HTTP layer, everything
else falls out of it. An HTTP handler can push a message into the WebSockets of
its own session. An SSE stream reads the same object the REST call read. A native
client on a raw TCP socket, once its session is identified, sees the world the
browser sees. None of this needs coordination code — it is one state with several
readers.

---

## 2. Anatomy of a request

### 2.1 There is no router

`createMockServer` (`packages/mocksmith/src/createMockServer.ts`) installs a
single request listener. Inside it is a chain of checks, each of which either
answers the request and returns, or falls through to the next one:

```ts
// the real shape, abridged
const requestListener = (req, res) => {
  if (req.url.startsWith('/__healthcheck')) { res.end(); return; }

  if (req.url.startsWith('/__mocks'))       { /* system API */ return; }

  const sse = sseHandlers?.find(({ path }) => req.url.startsWith(path));
  if (sse)                                  { sse.handler(req, res, ctx); return; }

  // … session → override → handler
};
```

This is plain early-return control flow, and it has one consequence worth
stating explicitly: **the order of the checks is the logic**. Swapping two `if`s
changes the server's behaviour. So each step below is documented with *why it
sits where it does*, not just what it does.

### 2.2 The sequence

```
incoming request
  │
  ├─ 1. url starts with /__healthcheck ?     → 200, empty body, done
  │
  ├─ 2. url starts with /__mocks ?           → SYSTEM session, system routes, done
  │        the system session is created lazily and holds no user data
  │
  ├─ 3. an SSE handler path is a prefix ?    → resolve session, hand over (req, res), done
  │        no session → 401 "Session not found"
  │
  ├─ 4. rewritePath configured ?             → rewrite the pathname (query kept as is)
  │
  ├─ 5. resolve the session
  │        cookie (default name mockContextId) → session by id
  │        Authorization: Bearer <token>       → session bound to that token
  │        neither present                     → the default session
  │        present but unknown                 → 401 "Session not found"
  │
  ├─ 6. context.getOverride(path, query) ?
  │        abort → res.destroy(), the client sees a network error
  │        delay → await
  │        → status / headers / body, and the handler is never called
  │
  └─ 7. context.processMock(...) → the handler
           exact key match first, then path-to-regexp patterns
           handler returns undefined or throws → "Mock not found" → 404
```

### 2.3 Step by step, and why the order

#### 1 — healthcheck

A service endpoint whose only job is to answer "I am alive". It computes nothing
and touches no session. It exists because **startup is not instantaneous**: the
process is up, the config is still loading, the port is not listening yet.
Something has to know when real requests can start.

```bash
curl -i http://127.0.0.1:3101/__healthcheck
# HTTP/1.1 200 OK
# Content-Length: 0
```

Its main caller is the Vite plugin, which starts the mock server as a child
process and refuses to hand over the dev server until this answers:

```ts
startProcessAndWaitPlugin({
  name: 'mocksmith',
  command: 'npx',
  args: ['mocksmith', 'start', '--config', './mocksmith.config.ts'],
  healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,   // polled every 250 ms, 60 s budget
})
```

It is first because it is asked when nothing about the server is known yet: it
must answer even before any session or resource exists, so it depends on nothing.

#### 2 — the system API

A set of service routes under `/__mocks/api/` used to **drive a running server**:
create a session, patch data, override an endpoint, push into a socket. It is not
part of the API you are mocking, and the double-underscore prefix is there to
guarantee it never collides with real application paths.

All server control is plain HTTP, and this protocol has three independent
clients: the CLI, the Playwright fixture, and plugins (which call the same routes
in-process).

```bash
# create a session with its own world
curl -X POST http://127.0.0.1:3101/__mocks/api/createSession \
  -H 'content-type: application/json' \
  -d '{"mocksAPI":{"user":{"name":"Grace","plan":"free"}},"id":"t1"}'
# → {"cookieName":"mockContextId","id":"t1"}

curl -X POST .../getSession       -d '{"id":"t1"}'
curl -X POST .../patchSession     -d '{"id":"t1","patch":{"user":{"plan":"pro"}}}'
curl -X POST .../setOverride      -d '{"id":"t1","path":"/api/items","status":503}'
curl -X POST .../sendToWebsocket  -d '{"id":"t1","data":{"data":{"type":"pushed"}}}'
curl -X POST .../clearSession     -d '{"id":"t1"}'
```

It runs *before* session resolution because it is what creates sessions —
resolving one first would make `createSession` impossible on a fresh server. The
useful side effect: these calls are served by the reserved `system` session, so
they cannot corrupt the world a test is asserting on, even while managing it.

#### 3 — SSE

**Server-Sent Events** is a way to stream events from server to browser. There is
no new protocol involved: it is an ordinary HTTP response that is *never closed*.
The server replies with `content-type: text/event-stream` and keeps appending
`data: …` lines as events happen.

| | SSE | WebSocket |
| --- | --- | --- |
| direction | server → client only | both ways |
| protocol | plain HTTP | separate, via upgrade handshake |
| reconnect | the browser does it | you write it |
| payload | text only | text and binary frames |

```ts
// sseHandlers.ts
import type { SseHandler } from 'mocksmith';

const ticks: SseHandler = {
  path: '/sse/ticks',
  handler: (_req, res, context) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    let tick = 0;
    const timer = setInterval(() => {
      // the format is strict: "data: " + payload + TWO newlines
      res.write(`data: ${JSON.stringify({ tick: ++tick })}\n\n`);
    }, 200);

    // res.end() is never called — the client closes the stream
    res.on('close', () => clearInterval(timer));
  },
};

export default [ticks];
```

```ts
// the client side is three lines, and reconnects for free
const source = new EventSource('/sse/ticks');
source.onmessage = (event) => console.log(JSON.parse(event.data));
```

```bash
curl -N http://127.0.0.1:3101/sse/ticks     # -N disables output buffering
# data: {"tick":1}
# data: {"tick":2}
```

Registered in the config as `sseHandlers`. Matched by path prefix, not exact
equality. It sits in its own branch above the mock logic because the normal
"build a body, call `end()`" machinery cannot express a response that never ends.

> Forgetting `res.on('close', …)` leaks a timer per connection, and the test
> process will not exit.

#### 4 — `rewritePath`

Optional. Rewrites the pathname *before* the mock lookup; the query string is
preserved, and returning `undefined` leaves the path alone.

The real case: the app talks to a gateway, so URLs look like
`/gateway/v2/shop/items`, while handler keys are much nicer as `/api/items`.
Rather than duplicating that prefix in every key, normalise the path once.

```ts
// rewritePath.ts
import type { RewritePath } from 'mocksmith';

const rewritePath: RewritePath = (path) => {
  const match = path.match(/^\/gateway\/v\d+\/\w+(\/.*)$/);

  return match ? `/api${match[1]}` : undefined;
};

export default rewritePath;
```

| Incoming | After rewrite | Handler key |
| --- | --- | --- |
| `/gateway/v2/shop/items?page=2` | `/api/items?page=2` | `/api/items` |
| `/gateway/v3/shop/items` | `/api/items` | the same key |
| `/api/profile` | unchanged | `/api/profile` |

#### 5 — session resolution

Mechanically, the server holds a `Map` from session id to `MockContext`. This
step decides which key to read:

```ts
// session.ts, abridged
getByRequestOrDefault(req) {
  const idFromCookie = getContextIdFromCookie(req, this.cookieName);
  if (idFromCookie) return this.contexts.get(idFromCookie);   // may be undefined → 401

  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token) return this.getByToken(token);

  return this.getDefaultSession();   // no cookie, no token: manual development
}
```

**Where the session actually gets set — four situations.**

*(1) A browser during development.* You do nothing: no cookie means the `default`
session, created at startup from `defaultSessionData`. That is the world
`mocksmith session set …` edits.

*(2) A Playwright test.* The fixture does all of it:

```ts
const session = await requestCreateMockContext(
  context.request,
  mocksAPI,
  `${testInfo.testId}-retry:${testInfo.retry}-worker:${testInfo.workerIndex}`
);

rememberSessionCookieName(context, session.cookieName);   // the name is not guessed
await context.addCookies([
  { name: session.cookieName, value: session.id, url: baseURL },
]);
```

*(3) By hand, with curl.* The same two moves:

```bash
curl -X POST .../createSession -d '{"mocksAPI":{"user":{"name":"Grace"}},"id":"t1"}'
curl http://127.0.0.1:3101/api/profile -H 'Cookie: mockContextId=t1'
```

*(4) By token*, for clients that send no cookies:

```ts
// bound in the config for the default session…
export default defineMockerConfig({ session: { tokens: { access: 'dev-token-123' } }, /* … */ });
```

```bash
# …or bound when the session is created
curl -X POST .../createSession -d '{"mocksAPI":{},"id":"t1","tokens":{"access":"abc"}}'
curl http://127.0.0.1:3101/api/profile -H 'Authorization: Bearer abc'
```

The cookie name is configurable (`session.cookieName`), which is exactly why
`createSession` reports it back instead of letting clients hard-code it.

Two consequences of the cookie being bound to the **app's** origin: mock requests
must be same-origin (hence the dev-server proxy), and `localhost` and
`127.0.0.1` must not be mixed — cookies treat them as different hosts.

Everything below this line operates *inside a world*, so there is nowhere to go
until the world is known. The important case is a cookie or token naming a
session that no longer exists: that is a **401, not a silent fallback to
`default`**. A silent fallback would let a leftover tab read *and write* the
shared default world after its test finished, breaking the next test for reasons
nobody could trace.

#### 6 — overrides

Stored per session as a `Map` from path to a list of rules, plus call counters
for rules using `responses`. One rule:

```ts
{
  when: { query: { page: '>=2' } },   // a rule without `when` always matches

  status: 404,                         // either a single answer…
  body: { error: 'no such page' },
  headers: { 'x-trace': '1' },
  delay: 300,
  abort: false,

  responses: [                         // …or a series answered by call number
    { status: 200, body: { items: [] } },
    { status: 503, body: { error: 'items unavailable' } },
  ],
}
```

Five ways to set one, all equivalent:

```bash
mocksmith endpoint set /api/items --status 503 --delay 2000          # 1. CLI
curl -X POST .../setOverride -d '{"id":"default","path":"/api/items","status":503}'   # 2. HTTP
```

```ts
await applyScenario(page, {                                          // 3. a test
  endpoints: [{ path: '/api/items', status: 500 }],
});

await ctx.callSystemApi('setOverride', {                             // 4. a plugin
  id: 'default', path: '/api/items', status: 503,
});

const breakNext: MockFunction<ShopApi> = (_api, { context }) => {    // 5. a handler
  context.setOverride('/api/items', { status: 503 });

  return { response: { body: { armed: true } } };
};
```

Then, in order: `abort` destroys the connection, `delay` waits, and the
status/headers/body are written. **The handler is not called.** Overrides come
first because their whole purpose is distorting an answer without touching code —
applied afterwards they would have to "undo" a computed response, and dropping a
connection could not be expressed at all.

#### 7 — the handler

Exact key match first, then `path-to-regexp` patterns in declaration order — so
`/api/items/search` wins over `/api/items/:id`, which also matches.

```ts
// handlers.ts — every form of handler in one file
const getProfile: MockFunction<ShopApi> = (api) => ({
  response: { body: { name: api.user.name, plan: api.user.plan } },
});

const getItem: MockFunction<ShopApi> = (api, { requestData }) => {
  const item = api.items.find((i) => String(i.id) === requestData.urlParams.id);

  return item
    ? { response: { body: item } }
    : { response: { status: 404, body: { error: 'not found' } } };
};

const report: MockFunction<ShopApi> = async (api) => ({          // async is fine
  response: { body: { total: api.items.reduce((s, i) => s + i.price, 0) } },
});

// undefined means "not my request" → 404 Mock not found
const onlyForPro: MockFunction<ShopApi> = (api) =>
  api.user.plan === 'pro' ? { response: { body: { secret: true } } } : undefined;

export default {
  '/api/profile':     getProfile,
  '/api/items/:id':   getItem,
  '/api/items/search': search,
  '/api/report':      report,
  '/api/secret':      onlyForPro,
  '/api/config': { response: { body: { version: '1.0.0' } } },   // static, no function
} satisfies MockHandlers<ShopApi>;
```

Defaults: status 200, `content-type: application/json; charset=utf-8`, body
serialised as JSON — each overridable by what the handler returns.

The handler is last because it is the most general and most expensive step:
anything decidable more cheaply has already been decided. Returning `undefined`
or throwing produces `404 Mock not found`; the exception is caught and logged
rather than surfaced, which is why handlers should return explicit error
responses instead of throwing.

### 2.4 Where it exited is what the client got

| Exit | Client sees | Typical cause |
| --- | --- | --- |
| 1 · healthcheck | `200`, empty body | Vite waiting for startup |
| 2 · system API | the system route's JSON | CLI, fixture, plugin |
| 3 · SSE | an open event stream | a subscription |
| 5 · no session | `401 Session not found` | a cookie from a deleted session |
| 6 · override | substituted response, a delay, or a dropped connection | `endpoint set`, a scenario |
| 7 · handler | a response computed from the world | an ordinary day |
| 7 · no handler | `404 Mock not found` | typo in a path, missing key |

### 2.5 Debugging backwards along the chain

The response almost always identifies the step:

| Symptom | Step | Next move |
| --- | --- | --- |
| an answer, but not the one in the handler | 6 | `mocksmith endpoint list`, then `endpoint clear --all` |
| `401 Session not found` | 5 | check whether the session in the cookie still exists |
| `404 Mock not found` | 7 | compare the path against the handler keys; check for a `undefined` return |
| right shape, wrong data | the world | `mocksmith session get` shows exactly what the handler reads |
| a network error instead of a status | 6 (`abort`) | …or CORS, meaning the request never reached the server |

Request parsing (`utils/parseIncomingRequest.ts`) produces
`{ path, query, body }`; JSON and `multipart/form-data` bodies are both decoded.
Responses default to `content-type: application/json; charset=utf-8;` unless the
handler sets its own headers.

---

## 3. Sessions

A session is an instance of `MockContext` (`src/context/context.ts`). The
registry that owns them is a module singleton, `sessions`
(`src/context/session.ts`).

### What a session holds

- `apiData` — the current world, plus `initialApiData`, a `structuredClone`
  snapshot taken at construction and used by `resetApiData()`.
- `overrides` — a `Map<path, OverrideRule[]>` plus per-rule call counters.
- `websockets` / `websocketConnections` — live sockets and a diagnostic history
  of every connection ever opened on this session, including closed ones.
- `contextData` — a free-form per-session scratch space (`setData` / `getData`).

Overrides are stored apart from handlers on purpose: `setHandlers` replaces the
handler table on **every** request, so anything kept next to it would be wiped.

### Identifying a session

`sessions.getByRequestOrDefault(req)` tries, in order:

1. the session cookie — name is configurable via `session.cookieName`, default
   `mockContextId` (`utils/getContextFromCookie.ts`);
2. `Authorization: Bearer <token>` — tokens are bound with `bindToken`, and a
   token already owned by another session is rejected rather than silently
   rebound;
3. an opaque **session key** (`createSessionKey` / `getBySessionKey`), for
   protocols that authenticate with a handed-out key rather than a header;
4. the default session, but **only when no cookie and no token were sent** —
   an unknown cookie is an error (401), not a reason to fall back.

`--allow-unauthorized` switches on a permissive local mode: token and session-key
checks are skipped and every such connection is routed into the default session.
It logs a warning, because it removes exactly the isolation the rest of the
design is about.

### Reserved sessions

| id | Role | Notes |
| --- | --- | --- |
| `default` | manual development in a browser | never reported as expired; id configurable via `defaultSessionId` |
| `system` | serves `/__mocks/api/*` | created on first use, holds no user data |

### Lifetime monitoring

Every 10 seconds the registry scans for non-default sessions older than
`SESSION_LIFETIME_THRESHOLD` (30 s) and logs a warning listing them. Nothing is
deleted — this is a leak detector for tests that forget `clearSession`, not a
garbage collector. The interval is `unref`'d so it never keeps a process alive.

### Session events

`sessions.onSessionCreated(listener)` notifies on every session, including the
per-test ones created by the Playwright fixture. Listeners run **synchronously**
(session creation is synchronous and sits on the hot path of every test) and a
throwing listener is logged and skipped rather than allowed to break creation.
This is the seam the scenarios plugin uses for its `default` option.

---

## 4. Handlers

A handler answers one path. It receives the world, not the request:

```ts
type MockFunction<M, R, D> = (
  mockApi: M,                         // session data
  params: {
    context: MockContext;             // the session itself
    request?: IncomingMessage;        // absent for in-process calls
    name: string;                     // the path the handler was found by
    requestData: {
      path: string | null;
      query: unknown;
      body: R;                        // parsed JSON or multipart
      urlParams?: any;                // captured pattern params
    };
  },
  sendToWebSocket: (data: D, delay?: number) => boolean
) => MockData<D> | Promise<MockData<D>> | undefined;
```

Example, from `examples/vite-app/handlers.ts`. One key serves both methods —
handlers are keyed by path, and the method is read from the request — and the
write goes through `context.getApiData()`, the live session object, because
`api` is a per-request shallow copy:

```ts
const todos: MockFunction<TodoApi> = (api, { context, request, requestData }, sendToWebSocket) => {
  const state = context.getApiData() as TodoApi;

  if (request?.method === 'POST') {
    const todo = { id: nextId(state.todos), title: requestData.body.title, done: false };

    state.todos.push(todo);
    // pushes into every socket of this session: another open tab updates
    sendToWebSocket({ type: 'todos', todos: state.todos });

    return { response: { status: 201, body: { todo, todos: state.todos } } };
  }

  return { response: { body: { todos: api.todos } } };
};

export default {
  '/api/todos': todos,
  '/api/todos/:id': todoById,   // `:id` arrives in requestData.urlParams
} satisfies MockHandlers<TodoApi>;
```

### Resolution

`findHandlerKey` (`utils/findHandlerKey.ts`) does the lookup: an exact key match
wins, then `path-to-regexp` patterns are tried in declaration order. Compiled
matchers are cached in a module-level `Map`, because `match()` rebuilds its
regexp on every call and a request may scan hundreds of keys.

An exact key beating a pattern matters in practice: `/api/items/previews` and
`/api/items/:id` both match the same URL, and the specific one must win.

### Return values

| Returned | Effect |
| --- | --- |
| `{ response: { body } }` | 200 with that body |
| `{ response: { status, headers, body } }` | full control |
| a plain object instead of a function | the same response every time |
| `undefined` | treated as "no mock": the request 404s with `Mock not found` |

Handler exceptions are caught in `proxyHandlers/mockHandler.ts` and logged; the
client then sees the same `Mock not found` 404. Do not throw for control flow —
return an explicit error response instead.

### Pushing into sockets from HTTP

The third argument comes from `createWebSocketSender`
(`proxyHandlers/requestHandler.ts`): it encodes through the configured encoder
and writes to **every socket of the same session**, optionally after a delay
(the timer is `unref`'d). It returns `false` when the session has no open
sockets, which is a useful assertion in tests.

---

## 5. Overrides

An override is a **list of rules** attached to a path:

```ts
type OverrideRule = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delay?: number;                                    // ms
  abort?: boolean;                                   // destroy the connection

  when?: { query?: Record<string, string | number> };
  responses?: OverrideResponse[];                    // answers by call number
};
```

`MockContext.getOverride(name, query)` implements the semantics:

1. **Path lookup** — an exact key first, then `path-to-regexp` over the override
   keys, so `/api/items/:id` is overridable exactly like a handler key.
2. **Rule selection** — the first rule whose `when.query` matches wins; a rule
   without `when` always matches, so it belongs last, like `default` in a switch.
3. **Query matching** — exact string comparison, or one of the operators
   `>`, `<`, `>=`, `<=`, `=` against a number. For a repeated parameter
   (`?s=a&s=b`) only the first value is considered.
4. **Response by call number** — with `responses`, the answer is
   `responses[min(callCount, length - 1)]`, so the last element repeats forever.
   Counters are keyed per `path::ruleIndex` and reset by `setOverride` on that
   path and by `resetApiData()`.

`abort` destroys the socket: the client sees a transport error
(`TypeError: Failed to fetch` in a browser), not an HTTP status. That is a
different code path in most applications than a 500, and worth testing
separately.

A worked example — "slow once, then broken":

```ts
{
  path: '/api/items',
  responses: [
    { status: 200, delay: 300, body: { items: [] } },
    { status: 503, body: { error: 'items unavailable' } },
  ],
}
```

> **Gotcha.** React `StrictMode` double-invokes effects in development, which
> consumes the first element of `responses` before you see it. The demo app
> disables `StrictMode` for exactly this reason, with a comment saying so.

---

## 6. Transports

### HTTP / HTTPS

The base case, described above. HTTPS is switched on with `--ssl` or
`server.ssl: true`, and then `ssl.key` / `ssl.cert` are required — the paths are
resolved relative to the config file and read at startup.

### WebSocket

`createWebSocketServer` (`src/createWebSocketServer.ts`) creates a `noServer`
`WebSocketServer` per upgrade, with compression disabled (throughput over size),
`maxPayload` of 1 MB and `clientTracking: false`.

- **Registration.** Unless `sessionFromMessage` is set, the connection is
  registered against the session immediately. With `sessionFromMessage: true`
  registration waits until a handler returns a `MockContext` — the way to bind
  native clients that send no cookies.
- **Subprotocols.** `handleProtocols` echoes back one of
  `websocket.echoSubprotocols` when the client asks for it, otherwise the first
  requested one. Browsers usually request none, and then the callback never runs.
  Native clients often drop the connection if their subprotocol is not confirmed.
- **Unknown paths** are refused right away rather than left hanging.
- **Session death** is polled once a second: when the session is gone the socket
  is closed with code 1001.
- `ws.binaryType = 'arraybuffer'`.

**Frame type is part of the contract.** The default encoder
(`src/websocketEncoder.ts`) returns a **string**, which `ws` sends as a text
frame. A `Buffer` would go out as a binary frame, arrive in a browser as a
`Blob`, and make `JSON.parse(event.data)` fail. Node clients hide this — 
`String(buffer)` reads fine — so it only ever shows up in a real page. A custom
encoder may still return a `Buffer` for genuinely binary protocols; whatever the
encoder returns is what goes on the wire.

Register a custom encoder with `websocket.encodeMessage` in the config or
`setWebsocketMessageEncoder()` in code.

### SSE

An SSE handler is `{ path, handler(req, res, context) }`. Matching is by path
prefix, and the handler owns the response: it writes its own headers and keeps
the stream open. Always clear timers on `res.on('close')` — nothing else will.

### Raw TCP / TLS

`createRawSocketServer` (`src/createRawSocketServer.ts`) opens one listener per
route, on its **own port**, plain or TLS:

```ts
rawSockets: {
  handler: './rawSocketHandler.ts',
  greetingHex: '0102',              // bytes written immediately on connect
  routes: [
    { path: '/feed/plain',  port: 3411 },
    { path: '/feed/secure', port: 3412, secure: true },
  ],
  tls: { minVersion: 'TLSv1.2' },
}
```

Raw connections are wrapped in a `RawSocketConnection` that implements the same
`SocketConnection` interface as a WebSocket (`readyState`, `send`, `close`,
`once('close')`), so context bookkeeping — `registerSocket`, diagnostics,
`closeWebsockets` — works identically across transports. Raw routes share
sessions and handlers with the HTTP server: a native client and a browser can
talk to the same mocked world.

Enable with `--raw-sockets` or `server.rawSockets: true`; starting without
`rawSockets.routes` in the config is a startup error.

---

## 7. The system API

Every runtime control action is a `POST` to a route under `/__mocks/api/`, so
any tool in any language can drive a running server. This is the protocol the
CLI, the Playwright fixture and plugins all speak.

| Route | Body | Purpose |
| --- | --- | --- |
| `createSession` | `{ mocksAPI, id?, tokens? }` | create a session; returns `{ id, cookieName }` |
| `clearSession` | `{ id }` | drop it |
| `getSession` | `{ id }` | read `apiData` |
| `patchSession` | `{ id, patch }` | deep-merge into `apiData` |
| `resetSession` | `{ id }` | restore the initial snapshot, clear overrides |
| `setOverride` | `{ id, path, ...rule }` | set override rules |
| `clearOverride` | `{ id, path? , all? }` | clear one or all |
| `getOverrides` | `{ id }` | list active overrides |
| `sendToWebsocket` | `{ id, data, path? }` | push into the session's sockets |
| `websockets/state` | `{ id, path? }` | connection diagnostics |
| `websockets/close` | `{ id, code?, reason?, path? }` | simulate a disconnect |
| `/__healthcheck` | `GET` | readiness probe |

`createSession` returning `cookieName` is deliberate: the name is configurable,
so clients ask rather than assume. `patchSession` revives ISO date strings
(`utils/revivePatchDate.ts`) so a patched `Date` stays a `Date`.

The exact route list is pinned by `systemHandlers.contract.test.ts`. Renaming or
removing a route fails that test — it is a breaking change to a protocol with
three independent clients.

Plugins add routes here too; `@mocksmith/scenarios` contributes `scenarios`,
`applyScenario` and `clearScenario`.

---

## 8. The CLI

`mocksmith` is a thin HTTP client plus one command that starts a server.
The command tree is built in `cli/createProgram.ts` from a `CliContext`
(`cli/context.ts`) holding `callApi`, `sessionId`, `getBaseUrl`, `reloadApp`,
`log` — commands never reach for module state, which is what makes the tree
testable.

```
mocksmith [--config <path>] [--url <url>] [--app-url <url>] [--session <id>] [--ssl]
├── start           --host --port --raw-sockets --allow-unauthorized
├── config print
├── session
│   ├── get [path]          print apiData, whole or a subtree by dot path
│   ├── set <path> <value>  value is parsed as JSON, falls back to a raw string
│   ├── date <iso|clear>
│   ├── patch <json>        raw deep merge
│   └── reset
├── endpoint
│   ├── set <path>   --status --body --header --delay --abort
│   ├── clear [path] --all
│   └── list
├── reload          POST /__mock_reload to the app (the Vite plugin)
└── <plugin commands>
```

Details that surprise people:

- **Plugin commands only appear when a config is loaded** (`--config` or
  `MOCKSMITH_CONFIG`), because that is where plugins are declared. Resolving
  plugins for the CLI runs no hooks, so importing a plugin module must have no
  side effects.
- **Values are JSON.** `session set user.plan '"free"'` — the inner quotes make
  it a JSON string. Without them the value is still accepted as a raw string,
  but `session set retries 3` would then be a string, not a number.
- **`reload` targets the app, not the mock server.** It needs `client.appUrl`,
  `--app-url` or `MOCKSMITH_APP_URI`.
- Older flat forms (`mocksmith get`, `endpoint-set`) still exist as hidden
  commands for backwards compatibility.

The command tree is snapshotted by `cli/createProgram.test.ts`, so an accidental
rename shows up as a diff.

---

## 9. The config and how it is loaded

The config is a TypeScript (or JS, or JSON) file. TypeScript is loaded through
`jiti` (`utils/importModule.ts`) with no loader registration.

**Resolution starts from the user's config path**, not from mocksmith's own
install — otherwise a bare package name like `@mocksmith/scenarios/plugin` would
be resolved relative to the wrong `node_modules` and fail. The same
`importModule` powers `ctx.loadModule` for plugins, so everything the user
writes resolves consistently.

### Shape

```ts
type MockerConfig = {
  server?: { host?; port?; rawSockets?; ssl? };
  defaultSessionData: object | string;          // inline or a module path
  defaultSessionId?: string;
  handlers: (MockHandlers | string)[];          // merged left to right
  session?: { cookieName?; tokens? };
  client?: { url?; appUrl?; sessionId? };       // defaults for the CLI
  websocketHandlers?: MockerWebsocketHandler[] | string;
  sseHandlers?: SseHandler[] | string;
  websocket?: { echoSubprotocols?; encodeMessage? };
  rawSockets?: { handler; greetingHex?; host?; routes; tls? };
  rewritePath?: RewritePath | string;
  ssl?: { key: string; cert: string };
  plugins?: MockerPluginEntry[];
  pluginDiscovery?: { auto?: boolean; patterns?: string[] };
};
```

Anything typed `MockerConfigResource<T>` accepts either the value inline or a
string path to a module exporting it. Paths are relative to the config file.

### Validation

`loadMockerConfig.ts` parses and validates before anything is loaded: ports must
be integers in range, `session.tokens` may only contain `access`,
`authorization` and `refresh`, raw-socket routes must be well formed, and so on.
Resource shapes are checked on load by `resourceValidators.ts`, so a typo
produces `handlers[1] must be ...` instead of a crash three layers deeper.

`config/configRoundTrip.test.ts` guards the parser against silently dropping a
field — a class of bug where a new option is added to the types and forgotten in
the reader.

---

## 10. Startup, step by step

`startMockerFromConfig` (`config/startMockerFromConfig.ts`) is the whole
composition root. In order:

1. **Guard raw sockets.** `--raw-sockets` without `rawSockets.routes` throws.
2. **Warn on a second start.** The session registry and websocket encoder are
   module singletons, so two servers in one process would quietly share state.
3. **Resolve plugins** (`resolvePlugins`) and build the plugin host
   (`createPluginHost`).
4. **`config` hook** — plugins may still amend the config.
5. **Resolve resources** — handlers (merged left to right with `Object.assign`),
   `defaultSessionData`, `rewritePath`, websocket handlers, SSE handlers, the
   websocket encoder. Each is validated.
6. **Install the encoder** with `setWebsocketMessageEncoder`.
7. **`setup` hook** — plugins write into the registries: handlers, system
   routes, SSE and WS handlers, a patch for the default session data.
8. **Merge system routes** — built-ins plus plugin routes; a plugin replacing a
   built-in is an error.
9. **Apply the session-data patch** from plugins (`lodash.merge`).
10. **Configure the registry** — cookie name, default session id, permissive
    mode — then **create the default session** from a `structuredClone` of the
    resolved data, binding any configured tokens.
11. **Read TLS material** if HTTPS or any secure raw route is enabled; missing
    `ssl.key`/`ssl.cert` is an error here.
12. **Resolve host and port**:

    ```
    --port  ??  config.server.port  ??  MOCKSMITH_PORT  ??  3001
    --host  ??  config.server.host  ??  MOCKSMITH_HOST  ??  127.0.0.1
    ```

    The config outranks the environment on purpose: projects that pin a port
    keep their behaviour. The environment step is what lets the Vite plugin hand
    over the port pair it reserved for configs that name no port.
13. **Create and start the server**, awaiting `listening`.
14. **`serverStarted` hook.**
15. **Register teardown** — closing the server disposes the plugin host.
16. **Start raw socket listeners** if enabled; a failure here closes the HTTP
    server rather than leaving a half-started process behind.

---

## 11. Plugins

A plugin extends a server from the outside: mock handlers, system routes, CLI
commands, websocket and SSE handlers, and lifecycle reactions.
`@mocksmith/scenarios` is itself a plugin and uses nothing private.

Full authoring guide: [docs/plugins.md](./plugins.md). Summary here.

### Shape

Export a **factory**, so each use gets its own closure instead of shared module
state:

```ts
import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';

export const greeter = (options: { greeting?: string } = {}): MocksmithPlugin => {
  const seen = new Set<string>();          // per-instance state

  return definePlugin({
    name: 'greeter',
    setup(ctx) {
      ctx.addHandlers({
        '/api/hello': () => ({ response: { body: { text: options.greeting ?? 'hi' } } }),
      });
    },
  });
};
```

### Hooks

| Hook | When | Typical use |
| --- | --- | --- |
| `config(config, env)` | config parsed, resources not resolved | amend the config |
| `setup(ctx)` | resources resolved, server not created | the main extension point |
| `serverStarted(ctx)` | the server is listening | announce, seed state |
| `sessionCreated(ctx)` | any session appears, per-test ones included | per-session defaults |
| `close()` | the server is closing | release resources |

`enforce: 'pre' | 'post'` orders plugins the way it does in Vite.
`apiVersion` is checked against `PLUGIN_API_VERSION` and a mismatch is refused
loudly at load time rather than failing obscurely later.

`sessionCreated` is **synchronous** and sits on the hot path of session
creation; everything it typically needs (`setOverride`, `patchApiData`) is
synchronous anyway.

### The setup context

```ts
ctx.addHandlers(handlers)                    // user config wins by default
ctx.addHandlers(handlers, { override: true })// unless you insist
ctx.addSystemHandlers({ greetings })         // → /__mocks/api/greetings
ctx.addSseHandlers([...])
ctx.addWebsocketHandlers([...])
ctx.patchDefaultSessionData({ ... })         // before the session exists
ctx.callSystemApi('setOverride', { ... })    // in-process, same signature as HTTP
ctx.sessions                                 // read-only registry view
ctx.loadModule('./thing.ts')                 // the config's resolver
ctx.store                                    // Map, namespaced per plugin
ctx.logger                                   // prefixed [mocksmith:<name>]
ctx.onClose(fn)
```

`callSystemApi` is the reason one implementation serves three transports: the
scenarios plugin applies a scenario from the server, the CLI and a Playwright
test with the same code.

### System route rules

Enforced in `plugin/mergeSystemHandlers.ts`:

- a plugin **cannot replace a built-in route** — the system API is a protocol
  with independent clients;
- **two plugins cannot claim the same route** — the winner would depend on
  plugin order, which is the kind of bug that only reproduces on someone else's
  machine.

Keys may be bare names (`greetings`) or full paths, and routes are matched with
the same matcher the mocks use, so `/__mocks/api/greetings/:id` works.

### CLI commands as data

Commands are described as plain objects, so a plugin never depends on
`commander`:

```ts
cli: [
  {
    name: 'greet',
    defaultSubcommand: 'say',        // `mocksmith greet Ada` → `greet say Ada`
    commands: [
      {
        name: 'say',
        args: [{ name: 'who', required: true }],
        options: [{ flags: '--loud' }],
        action: async (ctx, args, options) => {
          await ctx.callApi('greetings', { who: args.who, loud: options.loud });
        },
      },
    ],
  },
],
```

### Discovery

Plugins run because the config lists them. Discovery among installed packages is
opt-in (`pluginDiscovery: { auto: true }`), and even then a package must opt in
from its own manifest:

```jsonc
{ "mocksmith": { "plugin": "./plugin" } }
```

The value is an **export subpath**, and the loader builds
`@mocksmith/scenarios/plugin` from it. Importing the package root instead lands
on a module that exports no plugin — that was a real bug, and
`plugin/discovery.test.ts` now pins the behaviour.

### Rules of thumb

- No mutable module-level state; use the factory closure or `ctx.store`.
- Never import the session registry directly — use `ctx.sessions`.
- Declare `mocksmith` as a **peer** dependency, so the tree holds one core.
- Importing your plugin module must have no side effects.

---

## 12. Scenarios

### 12.1 Wiring the plugin, step by step

This is the most common plugin installation, and it is worth walking through
once, because two of its steps are where people get stuck.

**1. Install the package.**

```bash
npm install --save-dev @mocksmith/scenarios
```

The core does not change: `mocksmith` still knows nothing about scenarios. The
package declares the core as a **peer** dependency, so it uses the one you
already have rather than pulling a second copy.

**2. Enable it in the config.** Installing is not enough — a plugin runs because
the config says so, never because it is present in `node_modules`.

```ts
// mocksmith.config.ts
import { scenarios } from '@mocksmith/scenarios/plugin';   // the /plugin subpath
import { defineMockerConfig } from 'mocksmith/config';

import handlers from './handlers';
import session from './session';

export default defineMockerConfig({
  handlers: [handlers],
  defaultSessionData: session,
  plugins: [scenarios({ dir: '.' })],   // call the factory, don't pass the function
});
```

> The two mistakes made here: importing the package root (`from
> '@mocksmith/scenarios'`) — that gives `defineScenario` and types, not the
> plugin — and passing `scenarios` instead of `scenarios({ … })`.

Options: `dir`, `include`, `exclude`, inline `scenarios`, and `default` (a
scenario applied to every new session).

**3. Write a scenario file.** The filename must match the glob — by default
`*.scenario.ts`:

```
my-app/
├── mocksmith.config.ts       ← plugins: [scenarios({ dir: '.' })]
├── handlers.ts
├── session.ts
└── degraded.scenario.ts      ← found by the *.scenario.ts glob
```

**4. Confirm it was picked up.** The plugin announces itself at startup:

```
[mocksmith:scenarios] 1 scenario(s) registered: Degraded shop
🔨 mocksmith is up: http://127.0.0.1:3101
```

```bash
npx mocksmith --config ./mocksmith.config.ts scenario list
```

> If `scenario` is "not a known command", the CLI was started without a config —
> plugin commands only exist once the config that declares them is loaded. Set
> `MOCKSMITH_CONFIG=./mocksmith.config.ts` to stop passing the flag every time.

**5. Use it** — from the CLI while developing, and by name from tests:

```bash
npx mocksmith scenario apply "Degraded shop"
npx mocksmith scenario clear
```

```ts
await applyScenario(page, 'Degraded shop');
```

### 12.2 What a scenario is

`@mocksmith/scenarios` turns "a situation" into a named, declarative file shared
by e2e tests and manual QA.

```ts
import { defineScenario } from '@mocksmith/scenarios';

export default defineScenario({
  name: 'Degraded shop',
  feature: 'Reliability',
  description: 'Items time out once, then keep failing.',
  session: {
    patch: { user: { plan: 'free' } },
    flags: { NEW_CHECKOUT: true },      // sugar → apiData.remoteConfigFlags
  },
  endpoints: [
    {
      path: '/api/items',
      responses: [
        { status: 200, delay: 300, body: { items: [] } },
        { status: 503, body: { error: 'items unavailable' } },
      ],
    },
  ],
});
```

Register the plugin:

```ts
plugins: [scenarios({ dir: './mocks' })]
```

Options: `include` / `exclude` globs, `dir` shorthand, inline `scenarios`, and
`default` — a scenario applied to every new session.

### How it works

- **`setup`** globs `**/*.scenario.{ts,mts,cts,js,mjs,cjs}` relative to the
  config (ignoring `node_modules` and `dist`), loads each file, and registers it
  under `scenario.name` or a name derived from the filename. Inline scenarios are
  registered too. The registry is kept in the factory closure and also published
  to `ctx.store`.
- **System routes**: `scenarios` (the catalogue), `applyScenario`,
  `clearScenario`.
- **`sessionCreated`** applies the `default` scenario straight to the context —
  no HTTP round trip, because the hook must stay synchronous.
- **CLI**: a `scenario` command group with `defaultSubcommand: 'apply'`.

Applying a scenario means: clear existing overrides, deep-merge
`session.patch`, merge `session.flags` into `remoteConfigFlags`, then
`setOverride` for each endpoint. `endpointsToRules` groups endpoints by path so
several rules on one path become an ordered rule list. A deprecated
single-`response` alias is normalised into the modern shape.

Unless `reload: false`, the CLI then asks the app to reload.

### Purity rule

`@mocksmith/eslint-plugin` allows only imports and `defineScenario(...)` /
`defineTestScenario(...)` / `defineEndpoint(...)` at the top level of a scenario
file. The point is not tidiness: case constants belong next to the test and get
imported, so the mock and the assertions share one constant instead of drifting.

---

## 13. Playwright

```ts
import { mockTest } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';

mockTest('items degrade under load', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, 'Degraded shop');
  await page.goto('/');

  await expect(page.getByTestId('items-error')).toContainText('503');
});
```

`mockTest` extends the built-in `test` with:

- a **`context` override that reuses the built-in fixture** and only adds
  `blockExternalRequests`. Creating a fresh `browser.newContext()` — which is
  what it used to do — silently loses tracing, video, screenshots and project
  options like `viewport`, `locale` and `storageState`.
- **`initMockContext(data)`**, which creates a session whose id is derived from
  `testId + repeatEachIndex + retry + workerIndex + parallelIndex` (unique even
  across retries and repeats), then sets the cookie **named by the server** on
  the `baseURL` origin, and records that name via `rememberSessionCookieName`
  (a `WeakMap` keyed by `BrowserContext`). Teardown calls `clearSession`.

`applyScenario` reads the session id back through `readSessionId`, which looks
up the remembered cookie name — the fix for a bug where the fixture set a
configurable name and the scenario code searched for a hard-coded constant.

Requirements, both of which produce clear errors when missed:

- **`use.baseURL`** — the session cookie has to be bound to an origin.
- **`MOCKSMITH_URI`** — read when the module is first imported, so it must be set
  before any spec loads. The example sets it in `playwright.config.ts`.

`blockExternalRequests` aborts non-local requests and answers image requests
with an SVG placeholder (`getImageStub`), so tests never depend on the network.
Matching happens at the pattern level rather than funnelling every request
through `route.continue()`.

---

## 14. Vite

`@mocksmith/vite` contains three independent pieces.

**`getMockPortsEnv({ protocol?, host? })`** reserves a free *(app, mock server)*
port pair, coordinating through a lock file and a reservation registry in the
system temp directory, so several dev sessions on one machine never collide.
Stale reservations (dead pid, or older than 30 s without a listener) are
reclaimed. It returns:

```
MOCKSMITH_PORTS_RESOLVED=true   PORT=<app>   MOCKSMITH_PORT=<mock>
MOCKSMITH_URI=http://host:<mock>            MOCKSMITH_APP_URI=http://host:<app>
```

Under `CI`, or when `MOCKSMITH_PORTS_RESOLVED` is already set, it passes the
preferred ports through untouched instead of reserving. The scheme defaults to
`http`; it used to be hard-coded to `https`, which made the healthcheck open a
TLS handshake against a plain HTTP port and time out after 60 seconds.

**`startProcessAndWaitPlugin`** spawns a process and polls a healthcheck URL
(250 ms interval, 60 s timeout, 2 s per request, `rejectUnauthorized: false`)
before letting the dev server come up.

**`mockReloadPlugin`** exposes `POST /__mock_reload` on the dev server and
broadcasts an HMR `full-reload`. This is what makes `mocksmith reload` and
`scenario apply` refresh the open page; no application code is involved.

A verified `vite.config.ts` lives in
[`examples/vite-app`](../examples/vite-app). Two non-obvious requirements:

- **A proxy is mandatory.** The mock server sends no CORS headers at all, so the
  app must reach it same-origin through the dev server. `/ws` needs
  `{ ws: true }`.
- **Host consistency matters.** Cookies treat `localhost` and `127.0.0.1` as
  different hosts; mixing them makes session isolation fail silently.

---

## 15. Packages and the workspace

### 15.1 Monorepo and workspaces, from scratch

A **package** is a directory with a `package.json` carrying a name and a version.
That is all — everything installed from npm is one. When a project grows to
several related packages there are two ways to store them:

| | Five repositories | One monorepo |
| --- | --- | --- |
| a change touching two packages | two PRs, merge order matters | one PR |
| local development | `npm link` and its surprises | works out of the box |
| version consistency | by hand | by tooling |
| running everything | five times | one command |
| cost | — | more setup; needs a manager with workspaces |

A **monorepo** is one git repository holding several packages. The packages stay
separate — published separately, installed individually by users; what they share
is history, CI and conventions.

A **workspace** is the package-manager feature that makes this practical. You
declare where the packages live:

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'examples/*'
```

`pnpm install` at the root then installs dependencies for every package *and
links them to each other with symlinks*: `@mocksmith/scenarios` sees `mocksmith`
as the neighbouring directory rather than a downloaded tarball. Edit the core and
the companions see the edit immediately — no build, no publish.

```
packages/scenarios/node_modules/
└── mocksmith  ──symlink──▶  ../../packages/mocksmith
```

The link is declared with a protocol:

```jsonc
// packages/scenarios/package.json
{ "peerDependencies": { "mocksmith": "workspace:^" } }
```

npm's registry has no such protocol, so at pack time the manager **substitutes a
real range** (`^0.2.0`). This is the whole reason for the `pnpm pack`, never
`npm pack` rule: npm does not know the protocol and ships it verbatim, producing
a tarball that cannot be installed.

**Why pnpm specifically.** The difference that matters is what a package sees in
its own `node_modules`:

```
pnpm (strict)                        npm (hoisted)
examples/core-only/node_modules/     node_modules/            ← shared pile at the root
└── mocksmith    ← declared          ├── mocksmith
                                     ├── @mocksmith/scenarios ← hoisted from a sibling
import '@mocksmith/scenarios'        └── …
✖ Cannot find module                 import '@mocksmith/scenarios'  ✔ works anyway
```

Under npm, `examples/core-only` could import a companion it never declared, and
the isolation check would pass for the wrong reason. Under pnpm a package sees
exactly what it declared, so [the isolation test](#16-how-this-is-tested) means
something.

**Everyday commands**

| Command | Effect |
| --- | --- |
| `pnpm install` | install everything and link the packages together |
| `pnpm -r build` | run a script in every package (`-r` = recursive) |
| `pnpm --filter mocksmith test` | run it in one package |
| `pnpm --filter './packages/*' build` | filter by path glob |
| `pnpm --filter <pkg> add lodash` | add a dependency to one package |
| `pnpm -r --filter './packages/*' pack` | build the tarballs a user would install |

**Adding a package**: create `packages/<name>` (already covered by the glob),
write its `package.json` with `exports` and scripts, declare neighbours as
`"workspace:^"`, run `pnpm install`.

### 15.2 How it is applied here

The promise: **install the core and you get the core.** Everything optional is a
separate package, on the xstate / vitest model.

| Package | Contents | Peer dependencies |
| --- | --- | --- |
| `mocksmith` | server, sessions, overrides, config, CLI, plugin API | — |
| `@mocksmith/scenarios` | named scenarios; itself a plugin | `mocksmith`; optional: `@mocksmith/playwright`, `@playwright/test` |
| `@mocksmith/playwright` | the test fixture | `mocksmith`, `@playwright/test` |
| `@mocksmith/vite` | dev-server integration | `vite` |
| `@mocksmith/eslint-plugin` | scenario purity rule | `eslint` |

Peer dependencies exist so the tree holds exactly one core: two copies would
mean two session registries, and a scenario would be applied to a session the
browser never visits.

### Layout

```
mocksmith/
├── pnpm-workspace.yaml        packages/* and examples/*
├── .releaserc.json            semantic-release: one version for every package
├── scripts/{setVersion,publishPackages}.mjs
├── packages/{mocksmith,scenarios,playwright,vite,eslint-plugin}
├── examples/{basic,core-only,vite-app}
└── .github/workflows/{ci,release}.yml
```

**pnpm, not npm.** pnpm's strict `node_modules` means a package sees only what
it declares. Under npm's hoisting the isolation checks would pass for the wrong
reason — `core-only` would "accidentally" see the scenarios package hoisted from
a sibling.

### Exports

Subpaths are boundaries, not decoration:

```
mocksmith                        server runtime and types
mocksmith/config                 defineMockerConfig, config loading
mocksmith/plugin                 definePlugin, plugin API types
mocksmith/client                 light types for client-side code
@mocksmith/scenarios             defineScenario, types
@mocksmith/scenarios/plugin      the plugin itself
@mocksmith/scenarios/playwright  applyScenario
```

### Build and release

- **tsup**, ESM only, with `.d.ts` generation. The core has five entries
  (`index`, `client`, `config`, `plugin`, `cli`); a post-build step prepends the
  shebang to `dist/cli.js` and marks it executable.
- **`pnpm pack`, never `npm pack`.** npm leaves `workspace:^` in peer
  dependencies and the resulting tarball cannot be installed; pnpm substitutes
  real version ranges.
- **semantic-release**, driven by the commit history. See below.

### The release, in detail

There is no version to bump by hand and no changelog to edit. A push to `main`
runs `.github/workflows/release.yml`, and semantic-release does the rest:

1. **Reads the commits since the last tag.** `fix:` → patch, `feat:` → minor,
   `BREAKING CHANGE:` in a body → major (while the version is below 1.0.0, a
   breaking change moves the minor). Anything else — `docs:`, `chore:`, `test:`,
   `ci:`, `refactor:` — releases nothing on its own.
2. **Writes the notes** into `CHANGELOG.md`, grouped by type.
3. **Sets one version everywhere** — `scripts/setVersion.mjs` writes it into the
   root manifest and all five packages. The packages move in lockstep, so
   matching versions mean compatibility and a user never has to check a table.
4. **Packs and publishes** — `scripts/publishPackages.mjs`. Two tools, on
   purpose: **pnpm packs**, because only pnpm rewrites `workspace:^` into a real
   range inside the tarball, and **npm publishes**, because only npm performs
   the OIDC exchange behind trusted publishing. The tarball pnpm produced is
   what npm uploads.
5. **Tags, opens a GitHub release, and commits back** the changelog and
   manifests as `chore(release): x.y.z [skip ci]`.

Two switches worth knowing:

- The job is gated on the repository variable `RELEASE_ENABLED`. Until it is
  set to `true`, a push to `main` runs CI and nothing else — no tag, no release,
  nothing on the registry.
- `pnpm release:dry-run` runs the pack-and-publish path locally against the
  registry's dry-run mode, which is the fastest way to see exactly what would be
  uploaded.

**No `NPM_TOKEN` anywhere.** Authentication is npm's trusted publishing: npmjs
lists this repository and this workflow file as the publisher for each package,
and the npm CLI trades GitHub's OIDC token for a short-lived registry one. The
first publish of a brand-new package still has to be done by a human — a
trusted publisher can only be configured on a package that already exists.

---

## 16. How this is tested

140 tests across 26 files, plus three CI jobs. The interesting part is what each
layer is meant to catch.

| Test | Guards |
| --- | --- |
| `packageIsolation.test.ts` | no `@mocksmith/*` in any dependency field of the core, and no companion import anywhere in `src` |
| `systemHandlers.contract.test.ts` | the exact system route list |
| `config/configRoundTrip.test.ts` | the config parser silently dropping a field |
| `config/portResolution.test.ts` | the `--port ?? config ?? env ?? default` chain, including `MOCKSMITH_PORT=0` |
| `cli/createProgram.test.ts` | the command tree, as a snapshot |
| `plugin/discovery.test.ts` | auto-discovery instantiating the declared subpath |
| `websocketEncoder.test.ts` | JSON leaving as a **text** frame |
| `socketsIntegration.test.ts` | raw TCP, TLS and WebSocket driven from a config by real `net` / `tls` / `ws` clients |

CI jobs:

- **`check`** — lint, typecheck, tests, build, on Node 20 and 22.
- **`smoke`** — packs every package, installs *only the declared tarballs* into
  `examples/basic` and `examples/core-only`, runs their smoke scripts. This is
  what makes the isolation claim mean something: it is verified through the same
  artefacts a user would install.
- **`browser`** — typechecks the demo against the built packages, then installs
  chromium and runs the Playwright suite in `examples/vite-app` against the real
  dev server, with fixed ports (`PORT=3200`, `MOCKSMITH_PORT=3201`) because CI
  disables port reservation. The typecheck is not decoration: the demo is the
  only place where handlers typed against a project's own session shape are fed
  to `defineMockerConfig`, and that combination did not compile until
  `MockerConfig['handlers']` stopped insisting on `MockHandlers<MocksAPI>`.

A fourth workflow, `release.yml`, repeats lint, typecheck, tests and build
before publishing anything — a release must never be the first time a check
runs. See [The release, in detail](#the-release-in-detail).

The reason for three jobs rather than one is empirical. When the packages were
split, unit tests were green while `@mocksmith/vite`, the Playwright fixture and
plugin discovery had never actually executed — and each contained a real defect
(an `https` URI against an http server, an ignored environment port, discovery
importing the wrong module, a cookie-name mismatch, a binary WebSocket frame,
and raw sockets never exercised end to end). Every one of them is now pinned by
a test that goes through the real seam.

---

## 17. Constraints and known limits

- **One server per process.** The session registry and the websocket encoder are
  module singletons; `startMockerFromConfig` warns on a second call in the same
  process. The plugin API is deliberately built around `ctx` accessors so this
  can change without breaking plugins.
- **No CORS headers.** By design — the app is expected to reach the mock server
  same-origin through a dev-server proxy.
- **ESM only**, Node ≥ 20.19.
- **Query matching on repeated parameters** considers only the first value.
- **`sessionCreated` must not block**; it runs synchronously on the session
  creation path.
- **Handler exceptions are swallowed** into a 404 `Mock not found`; return
  explicit error responses instead of throwing.

---

## 18. Environment variables

| Variable | Meaning |
| --- | --- |
| `MOCKSMITH_PORT` | server port when the config names none (default `3001`) |
| `MOCKSMITH_HOST` | host to bind when the config names none |
| `MOCKSMITH_URI` | mock server URI, read by the Playwright fixture at import time |
| `MOCKSMITH_APP_URI` | app URI used by `reload` |
| `MOCKSMITH_CONFIG` | default `--config` value |
| `MOCKSMITH_SESSION_ID` | default `--session` value |
| `MOCKSMITH_LOG_LEVEL` | `trace` … `error` (default `info`) |
| `MOCKSMITH_PORTS_RESOLVED` | set by `getMockPortsEnv` so a child process does not reserve ports again |

Port parsing is explicit rather than truthy (`env.ts`): `MOCKSMITH_PORT=0` means
port zero, not "unset". An empty or out-of-range value is treated as unset.

---

## See also

- [README](../README.md) — the tour and quick start
- [docs/plugins.md](./plugins.md) — writing a plugin
- [`examples/basic`](../examples/basic) — HTTP, websockets, SSE, scenarios
- [`examples/core-only`](../examples/core-only) — the core alone, isolation proof
- [`examples/vite-app`](../examples/vite-app) — The Forge Board: a React todo app
  on HTTP + websocket + SSE, driven by Playwright in a real browser
