# Writing a mocksmith plugin

A plugin extends a mock server from the outside: it can add mock handlers, its
own routes on the system API, CLI commands, websocket and SSE handlers, and it
can react to the server's lifecycle.

`@mocksmith/scenarios` is itself a plugin — everything below is what it uses.

## Shape

A plugin is an object with a name. Export a factory rather than a ready object,
so each use gets its own closure instead of sharing module state:

```ts
import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';

export type GreeterOptions = { greeting?: string };

export const greeter = (options: GreeterOptions = {}): MocksmithPlugin => {
  const seen = new Set<string>();          // per-instance state lives here

  return definePlugin({
    name: 'greeter',

    setup(ctx) {
      ctx.addHandlers({
        '/api/hello': () => ({ response: { body: { text: options.greeting ?? 'hi' } } }),
      });
    },
  });
};

export default greeter;
```

Add it to the config:

```ts
import { greeter } from 'mocksmith-plugin-greeter';

export default defineMockerConfig({
  handlers: [handlers],
  defaultSessionData: session,
  plugins: [greeter({ greeting: 'hello' })],
});
```

A plugin can also be referenced as a string, which is what JSON configs use:

```jsonc
{ "plugins": [{ "use": "mocksmith-plugin-greeter", "options": { "greeting": "hello" } }] }
```

The specifier is resolved from the user's config file, so both package names and
relative paths work, TypeScript included.

## Hooks

| Hook | When | Typical use |
| --- | --- | --- |
| `config(config, env)` | the config is parsed, its resources are not resolved yet | amend the config before it is read |
| `setup(ctx)` | resources resolved, server not created, default session not created | the main extension point |
| `serverStarted(ctx)` | the server is listening | announce something, seed state over the API |
| `sessionCreated(ctx)` | any session appears, including per-test ones | apply per-session defaults |
| `close()` | the server is closing | release what you acquired |

`setup` is where most plugins do their work:

```ts
setup(ctx) {
  ctx.addHandlers({ '/api/hello': handler });          // config handlers still win
  ctx.addHandlers({ '/api/hello': handler }, { override: true });   // unless you insist
  ctx.addSystemHandlers({ greetings: listGreetings }); // → /__mocks/api/greetings
  ctx.addSseHandlers([{ path: '/sse/greetings', handler }]);
  ctx.addWebsocketHandlers([{ path: '/ws/greetings', handler }]);
  ctx.patchDefaultSessionData({ greetings: [] });      // before the session exists
  ctx.onClose(() => stopTimer());
}
```

The context also carries `logger` (prefixed with your plugin name), `store` (a
`Map` scoped to your plugin), `sessions` (a read-only view of the registry),
`loadModule` (the same resolver the config uses) and `callSystemApi`.

### callSystemApi

`ctx.callSystemApi(endpoint, body)` invokes a system route in-process with the
same signature the CLI uses over HTTP. That means logic written once runs on
every transport — this is how `@mocksmith/scenarios` applies a scenario from the
server, the CLI and a Playwright test with a single implementation:

```ts
await ctx.callSystemApi('setOverride', {
  id: 'default',
  path: '/api/items',
  status: 503,
});
```

### sessionCreated is synchronous

It runs on the hot path of session creation, so it must not block; everything it
typically needs (`context.setOverride`, `context.patchApiData`) is synchronous
anyway. A throwing listener is logged and ignored rather than allowed to break
session creation.

## System routes

`addSystemHandlers` takes bare names (`greetings`) or full paths
(`/__mocks/api/greetings`). Two rules are enforced at startup:

- a plugin cannot replace a built-in route — the system API is the protocol the
  CLI and the fixtures speak;
- two plugins cannot claim the same route, since which one won would depend on
  plugin order.

Routes are matched with the same path matcher the mocks use, so patterns like
`/__mocks/api/greetings/:id` work.

## CLI commands

Commands are declared as data, so your plugin never depends on commander:

```ts
cli: [
  {
    name: 'greet',
    description: 'Greeting management',
    defaultSubcommand: 'say',          // `mocksmith greet Ada` → `greet say Ada`
    commands: [
      {
        name: 'say',
        args: [{ name: 'who', required: true }],
        options: [{ flags: '--loud', description: 'shout it' }],
        action: async (ctx, args, options) => {
          await ctx.callApi('greetings', { who: args.who, loud: options.loud });
          ctx.log.info(`greeted ${args.who}`);
        },
      },
    ],
  },
],
```

The action's context gives you `callApi` (HTTP to the running server),
`sessionId`, `reloadApp`, `loadModule` and `log`.

Two things follow from how the CLI works:

- plugin commands appear only when a config is loaded (`--config` or
  `MOCKSMITH_CONFIG`), because that is where plugins are declared;
- resolving plugins for the CLI runs no hooks, so **importing your plugin module
  must have no side effects** — do the work in `setup`, not at module load.

## Discovery

Plugins run because the config lists them. Discovery among installed packages
exists but is opt-in:

```ts
export default defineMockerConfig({
  pluginDiscovery: { auto: true },
});
```

Even then a package is only considered when it opts in from its `package.json`:

```jsonc
{ "mocksmith": { "plugin": "./dist/plugin.js" } }
```

## Rules of thumb

- **No module-level mutable state.** Keep it in the factory closure or in
  `ctx.store`; module state leaks between servers and between tests.
- **Don't import the session registry directly.** Use `ctx.sessions` — it is the
  seam that lets the core stop being a singleton without breaking plugins.
- **Declare `mocksmith` as a peer dependency**, not a regular one, so there is
  exactly one core in the tree.
- **Set `apiVersion`** if you want to be loud about incompatibility: the host
  refuses a plugin built for a different plugin API version instead of failing
  obscurely later.

## Known limitation

The session registry and the websocket encoder are module singletons, so a
process runs one mock server at a time. The plugin API is deliberately built
around `ctx` accessors so this can change without breaking plugins.
