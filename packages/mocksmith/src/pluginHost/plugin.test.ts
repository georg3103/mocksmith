import log from 'loglevel';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessions } from '../context/session';
import { startMockerFromConfig } from '../config/startMockerFromConfig';
import { definePlugin } from '../plugin/definePlugin';
import { SystemApiError } from '../plugin/SystemApiError';
import { createPluginHost } from './createPluginHost';
import { addPluginSystemHandlers, mergeSystemHandlers } from './systemRoutes';
import { resolvePlugins } from './resolvePlugins';

import type { ResolvedMockerConfig } from '../config/types';
import type { MocksmithPlugin } from '../plugin/types';

const fixturesDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const resolvedFor = (config: Partial<ResolvedMockerConfig['config']>): ResolvedMockerConfig => ({
  config: {
    handlers: [{}],
    defaultSessionData: {},
    ...config,
  } as ResolvedMockerConfig['config'],
  configDirectory: fixturesDirectory,
  configPath: path.join(fixturesDirectory, 'mocksmith.config.ts'),
  serverUrl: 'http://127.0.0.1:0',
});

const startWith = async (plugins: MocksmithPlugin[], overrides = {}) => {
  const server = await startMockerFromConfig(
    resolvedFor({
      plugins,
      server: { host: '127.0.0.1', port: 0 },
      handlers: [{ '/api/thing': { response: { body: { from: 'config' } } } }],
      defaultSessionData: { base: true },
      ...overrides,
    }),
    { host: '127.0.0.1', port: 0 }
  );

  if (!server.listening) {
    await once(server, 'listening');
  }

  const { port } = server.address() as AddressInfo;

  return {
    server,
    url: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
};

afterEach(() => {
  for (const id of sessions.listIds()) {
    sessions.clearSession(id);
  }

  sessions.setDefaultSessionId();
});

describe('plugin lifecycle', () => {
  test('runs the hooks in order and lets a plugin extend the server', async () => {
    const calls: string[] = [];

    const plugin = definePlugin({
      name: 'lifecycle',
      config(config) {
        calls.push('config');
        expect(config.handlers).toBeDefined();
      },
      setup(ctx) {
        calls.push('setup');
        ctx.addHandlers({ '/api/from-plugin': { response: { body: { from: 'plugin' } } } });
        ctx.addSystemHandlers({
          ping: () => ({ response: { body: { pong: true } } }),
        });
        ctx.patchDefaultSessionData({ addedByPlugin: true });
      },
      serverStarted(ctx) {
        calls.push('serverStarted');
        expect(ctx.server.listening).toBe(true);
      },
      close() {
        calls.push('close');
      },
    });

    const { url, close } = await startWith([plugin]);

    expect(calls).toEqual(['config', 'setup', 'serverStarted']);

    // the plugin's mock handler is served
    const fromPlugin = await fetch(`${url}/api/from-plugin`);

    expect(await fromPlugin.json()).toEqual({ from: 'plugin' });

    // its system route is served too, under the /__mocks/api prefix
    const ping = await fetch(`${url}/__mocks/api/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(await ping.json()).toEqual({ pong: true });

    // and its session patch landed in the default session
    const session = await fetch(`${url}/__mocks/api/getSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'default' }),
    });

    expect(await session.json()).toMatchObject({ base: true, addedByPlugin: true });

    await close();
    expect(calls).toContain('close');
  });

  test('config handlers win over plugin handlers unless the plugin insists', async () => {
    const polite = definePlugin({
      name: 'polite',
      setup(ctx) {
        ctx.addHandlers({ '/api/thing': { response: { body: { from: 'polite-plugin' } } } });
      },
    });
    const pushy = definePlugin({
      name: 'pushy',
      setup(ctx) {
        ctx.addHandlers(
          { '/api/thing': { response: { body: { from: 'pushy-plugin' } } } },
          { override: true }
        );
      },
    });

    const first = await startWith([polite]);

    expect(await (await fetch(`${first.url}/api/thing`)).json()).toEqual({ from: 'config' });
    await first.close();

    const second = await startWith([pushy]);

    expect(await (await fetch(`${second.url}/api/thing`)).json()).toEqual({ from: 'pushy-plugin' });
    await second.close();
  });

  test('sessionCreated fires for sessions made after startup', async () => {
    const seen: Array<{ id: string; isDefault: boolean; isSystem: boolean }> = [];

    const plugin = definePlugin({
      name: 'session-watcher',
      sessionCreated({ id, isDefault, isSystem }) {
        seen.push({ id, isDefault, isSystem });
      },
    });

    const { url, close } = await startWith([plugin]);

    await fetch(`${url}/__mocks/api/createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mocksAPI: {}, id: 'per-test' }),
    });

    expect(seen.map(({ id }) => id)).toContain('per-test');
    expect(seen.find(({ id }) => id === 'per-test')).toMatchObject({
      isDefault: false,
      isSystem: false,
    });

    await close();
  });

  test('callSystemApi drives the same routes as the HTTP transport', async () => {
    let applied: unknown;

    const plugin = definePlugin({
      name: 'in-process',
      async serverStarted(ctx) {
        await ctx.callSystemApi('setOverride', {
          id: 'default',
          path: '/api/thing',
          status: 503,
          body: { down: true },
        });
        applied = await ctx.callSystemApi('getOverrides', { id: 'default' });
      },
    });

    const { url, close } = await startWith([plugin]);

    expect(applied).toEqual([
      { path: '/api/thing', rules: [{ status: 503, body: { down: true } }] },
    ]);

    const response = await fetch(`${url}/api/thing`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ down: true });

    await close();
  });
});

describe('what a plugin contributes', () => {
  test('keeps the first claim on a path and says so', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const sse = { path: '/sse/feed', handler: () => undefined };

    const first = definePlugin({
      name: 'first',
      setup(ctx) {
        ctx.addHandlers({ '/api/thing': { response: { body: { from: 'first' } } } });
        ctx.addSseHandlers([sse]);
      },
    });
    const second = definePlugin({
      name: 'second',
      setup(ctx) {
        ctx.addHandlers({ '/api/thing': { response: { body: { from: 'second' } } } });
        ctx.addSseHandlers([{ path: '/sse/feed', handler: () => undefined }]);
      },
    });

    const host = createPluginHost([first, second], resolvedFor({}), {});
    const registries = await host.callSetup({ handlers: {}, sseHandlers: [], websockets: [] });

    expect(registries.handlers['/api/thing']).toEqual({ response: { body: { from: 'first' } } });
    // The shadowed handler is dropped rather than registered twice.
    expect(registries.sseHandlers).toEqual([sse]);

    const said = warn.mock.calls.flat().join(' ');

    expect(said).toContain('/api/thing');
    expect(said).toContain('/sse/feed');

    warn.mockRestore();
    await host.dispose();
  });

  test('callSystemApi throws when the route answers 4xx', async () => {
    let failure: unknown;

    const plugin = definePlugin({
      name: 'asks-for-a-missing-session',
      async serverStarted(ctx) {
        failure = await ctx.callSystemApi('getSession', { id: 'no-such-session' }).catch((e) => e);
      },
    });

    const { close } = await startWith([plugin]);

    expect(failure).toBeInstanceOf(SystemApiError);
    expect((failure as SystemApiError).status).toBe(404);
    expect((failure as SystemApiError).endpoint).toContain('getSession');

    await close();
  });
});

describe('plugin isolation and validation', () => {
  test('refuses to replace a built-in system route', () => {
    expect(() =>
      mergeSystemHandlers({ '/__mocks/api/setOverride': () => undefined }, {
        setOverride: () => undefined,
      })
    ).toThrow(/built-in system route/);
  });

  test('refuses two plugins claiming the same route', () => {
    const collected = addPluginSystemHandlers({}, { scenarios: () => undefined });

    expect(() => addPluginSystemHandlers(collected, { scenarios: () => undefined })).toThrow(
      /same system route/
    );
  });

  test('rejects a plugin built for another API version', async () => {
    await expect(
      resolvePlugins(
        resolvedFor({ plugins: [{ name: 'from-the-future', apiVersion: 99 } as never] })
      )
    ).rejects.toThrow(/plugin API v99/);
  });

  test('requires a name', () => {
    expect(() => definePlugin({ name: '  ' })).toThrow(/"name" is required/);
  });

  test('keeps the first of two plugins with the same name', async () => {
    const plugins = await resolvePlugins(
      resolvedFor({
        plugins: [
          { name: 'twin', enforce: 'post' } as never,
          { name: 'twin', enforce: 'pre' } as never,
        ],
      })
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0].enforce).toBe('post');
  });

  test('orders plugins pre → normal → post', async () => {
    const plugins = await resolvePlugins(
      resolvedFor({
        plugins: [
          { name: 'last', enforce: 'post' } as never,
          { name: 'middle' } as never,
          { name: 'first', enforce: 'pre' } as never,
        ],
      })
    );

    expect(plugins.map(({ name }) => name)).toEqual(['first', 'middle', 'last']);
  });

  test('skips an entry disabled in the config', async () => {
    const plugins = await resolvePlugins(
      resolvedFor({ plugins: [{ use: './does-not-exist.ts', enabled: false }] })
    );

    expect(plugins).toEqual([]);
  });

  test('does not discover installed plugins unless asked', async () => {
    const plugins = await resolvePlugins(resolvedFor({}));

    expect(plugins).toEqual([]);
  });
});
