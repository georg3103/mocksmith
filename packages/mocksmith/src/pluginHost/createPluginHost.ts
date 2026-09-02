import log from 'loglevel';
import merge from 'lodash.merge';
import { pathToFileURL } from 'node:url';

import { sessions, SYSTEM_SESSION_ID } from '../context/session';
import { importModule } from '../utils/importModule';
import { addPluginSystemHandlers } from './systemRoutes';
import { createSystemApiCaller } from './systemApi';

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

import type { MockerWebsocketHandler, ResolvedMockerConfig } from '../config/types';
import type { MockFunction, MockHandlers, MocksAPI, SseHandler } from '../types';
import type {
  MocksmithPlugin,
  PluginLogger,
  PluginSetupContext,
  SessionsFacade,
  StartMockerOptionsLike,
} from '../plugin/types';

/**
 * The mutable registries plugins contribute to during `setup`, handed to
 * createMockServer once every plugin has had its turn.
 * */
export type PluginRegistries = {
  handlers: MockHandlers<MocksAPI>;
  sseHandlers: SseHandler[];
  websockets: MockerWebsocketHandler[];
  systemHandlers: Record<string, MockFunction>;
  sessionDataPatch: object;
};

const prefixed = (name: string): PluginLogger => ({
  debug: (...args) => log.debug(`[mocksmith:${name}]`, ...args),
  info: (...args) => log.info(`[mocksmith:${name}]`, ...args),
  warn: (...args) => log.warn(`[mocksmith:${name}]`, ...args),
  error: (...args) => log.error(`[mocksmith:${name}]`, ...args),
});

const sessionsFacade: SessionsFacade = {
  getById: (id) => sessions.getById(id),
  getDefaultSessionId: () => sessions.getDefaultSessionId(),
  getDefaultSession: () => sessions.getDefaultSession(),
  listIds: () => sessions.listIds(),
};

export type PluginHost = ReturnType<typeof createPluginHost>;

/**
 * Drives the plugin lifecycle: it owns the registries plugins write into, the
 * per-plugin contexts, and the order hooks run in.
 * */
export const createPluginHost = (
  plugins: MocksmithPlugin[],
  resolved: ResolvedMockerConfig,
  options: StartMockerOptionsLike
) => {
  const registries: PluginRegistries = {
    handlers: {},
    sseHandlers: [],
    websockets: [],
    systemHandlers: {},
    sessionDataPatch: {},
  };

  const closers: Array<() => void | Promise<void>> = [];
  const stores = new Map<string, Map<string, unknown>>();
  const parentUrl = pathToFileURL(resolved.configPath).href;

  /** Built after setup, when the full system route table is known. */
  let systemHandlerTable: Record<string, MockFunction> = {};

  const callSystemApi = createSystemApiCaller(
    () => systemHandlerTable,
    () => sessions.getById(SYSTEM_SESSION_ID) ?? sessions.getDefaultSession()
  );

  const contextFor = (plugin: MocksmithPlugin): PluginSetupContext => {
    let store = stores.get(plugin.name);

    if (!store) {
      store = new Map();
      stores.set(plugin.name, store);
    }

    const logger = prefixed(plugin.name);

    /**
     * How a clash is reported, in one place. A system route or a CLI command is
     * addressed by name, so two claimants are a mistake to fail on; a mock, sse
     * or websocket path merely shadows, so the first registration stands and the
     * loser is told. Silence was the old behaviour for the last three, and it
     * made a plugin whose handler never ran look like a plugin that never
     * loaded.
     * */
    const warnShadowed = (kind: string, taken: string[]) => {
      if (taken.length) {
        logger.warn(
          `${kind} already registered, keeping the existing one: ${taken.join(', ')}` +
            (kind === 'handler(s)' ? ' — pass { override: true } to win' : '')
        );
      }
    };

    return {
      config: resolved.config,
      configDirectory: resolved.configDirectory,
      configPath: resolved.configPath,
      serverUrl: resolved.serverUrl,
      options,
      logger,

      addHandlers(handlers, opts) {
        if (!opts?.override) {
          warnShadowed(
            'handler(s)',
            Object.keys(handlers).filter((key) => key in registries.handlers)
          );
        }

        registries.handlers = opts?.override
          ? Object.assign(registries.handlers, handlers)
          : Object.assign({}, handlers, registries.handlers);
      },
      addSystemHandlers(handlers) {
        registries.systemHandlers = addPluginSystemHandlers(registries.systemHandlers, handlers);
      },
      addSseHandlers(handlers) {
        const taken = new Set(registries.sseHandlers.map(({ path }) => path));

        warnShadowed('sse path(s)', handlers.filter(({ path }) => taken.has(path)).map(({ path }) => path));
        registries.sseHandlers.push(...handlers.filter(({ path }) => !taken.has(path)));
      },
      addWebsocketHandlers(handlers) {
        const taken = new Set(registries.websockets.map(({ path }) => path));

        warnShadowed(
          'websocket path(s)',
          handlers.filter(({ path }) => taken.has(path)).map(({ path }) => path)
        );
        registries.websockets.push(...handlers.filter(({ path }) => !taken.has(path)));
      },
      patchDefaultSessionData(patch) {
        merge(registries.sessionDataPatch, patch);
      },
      callSystemApi,
      sessions: sessionsFacade,
      loadModule: <T,>(specifier: string) => importModule(specifier, parentUrl) as Promise<T>,
      store,
      onClose(fn) {
        closers.push(fn);
      },
    };
  };

  const sessionListeners = plugins.filter((plugin) => plugin.sessionCreated);
  let unsubscribeSessions: (() => void) | undefined;

  return {
    plugins,
    registries,

    /** Hook 1: plugins may amend the config before its resources are resolved. */
    async callConfig() {
      for (const plugin of plugins) {
        await plugin.config?.(resolved.config, {
          configDirectory: resolved.configDirectory,
          configPath: resolved.configPath,
          serverUrl: resolved.serverUrl,
          options,
        });
      }
    },

    /** Hook 2: the main extension point, before the server exists. */
    async callSetup(seed: Partial<PluginRegistries>) {
      Object.assign(registries, {
        handlers: seed.handlers ?? registries.handlers,
        sseHandlers: seed.sseHandlers ?? registries.sseHandlers,
        websockets: seed.websockets ?? registries.websockets,
      });

      for (const plugin of plugins) {
        await plugin.setup?.(contextFor(plugin));
      }

      if (sessionListeners.length) {
        unsubscribeSessions = sessions.onSessionCreated((context, meta) => {
          for (const plugin of sessionListeners) {
            try {
              plugin.sessionCreated?.({
                context,
                id: context.id,
                isDefault: meta.isDefault,
                isSystem: meta.isSystem,
                logger: prefixed(plugin.name),
              });
            } catch (error) {
              prefixed(plugin.name).warn('sessionCreated failed', error);
            }
          }
        });
      }

      return registries;
    },

    /** Makes the merged system route table available to callSystemApi. */
    setSystemHandlerTable(table: Record<string, MockFunction>) {
      systemHandlerTable = table;
    },

    /** Hook 3: the server is listening. */
    async callServerStarted(
      server: HttpServer | HttpsServer,
      address: { host: string; port: number; protocol: 'http' | 'https' }
    ) {
      for (const plugin of plugins) {
        await plugin.serverStarted?.({
          ...contextFor(plugin),
          server,
          url: `${address.protocol}://${address.host}:${address.port}`,
          ...address,
        });
      }
    },

    /** Hook 4: teardown. */
    async dispose() {
      unsubscribeSessions?.();

      for (const fn of closers.splice(0)) {
        try {
          await fn();
        } catch (error) {
          log.warn('A plugin close handler failed', error);
        }
      }

      for (const plugin of plugins) {
        try {
          await plugin.close?.();
        } catch (error) {
          prefixed(plugin.name).warn('close failed', error);
        }
      }
    },
  };
};
