import log from 'loglevel';
import merge from 'lodash.merge';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sessions } from '../context/session';
import { DEFAULT_MOCK_BACKEND_PORT, getMockEnv } from '../env';
import { createMockServer } from '../createMockServer';
import { createRawSocketServer } from '../createRawSocketServer';
import { createPluginHost } from '../pluginHost/createPluginHost';
import { mergeSystemHandlers } from '../pluginHost/systemRoutes';
import { resolvePlugins } from '../pluginHost/resolvePlugins';
import { systemHandlers } from '../systemHandlers';
import { setWebsocketMessageEncoder, type WebsocketMessageEncoder } from '../websocketEncoder';
import { loadConfigResource } from './loadConfigResource';
import { configResourceValidation } from './resourceValidators';

import type { MockFunction, MockHandlers, MocksAPI, RewritePath, SseHandler } from '../types';
import type {
  ConfigResourceValidator,
  MockerConfigResource,
  MockerRawSocketHandler,
  MockerWebsocketHandler,
  ResolvedMockerConfig,
  StartMockerOptions,
} from './types';

const { validators } = configResourceValidation;

let startCount = 0;

/**
 * The session registry and the websocket encoder are module singletons, so a
 * second server in the same process quietly reconfigures the first one.
 * */
const warnOnSecondStart = () => {
  startCount += 1;

  if (startCount > 1) {
    log.warn(
      'startMockerFromConfig was called more than once in this process. ' +
        'mocksmith keeps sessions in a module-level registry, so servers share state — ' +
        'run one mock server per process.'
    );
  }
};

const resolveResource = async <T>(
  configDirectory: string,
  resource: MockerConfigResource<T>,
  field: string,
  validator: ConfigResourceValidator<T>
) => {
  return typeof resource === 'string'
    ? loadConfigResource<T>(configDirectory, resource, field, validator)
    : resource;
};

export const startMockerFromConfig = async (
  resolved: ResolvedMockerConfig,
  options: StartMockerOptions = {}
) => {
  const { config, configDirectory } = resolved;
  const rawSocketsEnabled = Boolean(options.rawSockets || config.server?.rawSockets);
  const sslEnabled = Boolean(options.ssl || config.server?.ssl);

  if (rawSocketsEnabled && !config.rawSockets) {
    throw new Error('Raw sockets require rawSockets.routes in the config');
  }

  warnOnSecondStart();

  const pluginHost = createPluginHost(await resolvePlugins(resolved, options), resolved, options);

  await pluginHost.callConfig();

  const handlerSources = await Promise.all(
    config.handlers.map((resource, index) =>
      resolveResource<MockHandlers<MocksAPI>>(
        configDirectory,
        resource,
        `handlers[${index}]`,
        validators.handlers
      )
    )
  );
  const handlers = Object.assign({}, ...handlerSources);
  const defaultSessionData = await resolveResource<object>(
    configDirectory,
    config.defaultSessionData,
    'defaultSessionData',
    validators.defaultSessionData
  );
  const rewritePath = config.rewritePath
    ? await resolveResource<RewritePath>(
        configDirectory,
        config.rewritePath,
        'rewritePath',
        validators.rewritePath
      )
    : undefined;
  const websockets = config.websocketHandlers
    ? await resolveResource<MockerWebsocketHandler[]>(
        configDirectory,
        config.websocketHandlers,
        'websocketHandlers',
        validators.websocketHandlers
      )
    : undefined;
  const sseHandlers = config.sseHandlers
    ? await resolveResource<SseHandler[]>(
        configDirectory,
        config.sseHandlers,
        'sseHandlers',
        validators.sseHandlers
      )
    : undefined;

  const encodeMessage = config.websocket?.encodeMessage
    ? await resolveResource<WebsocketMessageEncoder>(
        configDirectory,
        config.websocket.encodeMessage,
        'websocket.encodeMessage',
        validators.websocketEncoder
      )
    : undefined;

  setWebsocketMessageEncoder(encodeMessage);

  const registries = await pluginHost.callSetup({
    handlers,
    sseHandlers: [...(sseHandlers ?? [])],
    websockets: [...(websockets ?? [])],
  });
  const allSystemHandlers = mergeSystemHandlers(
    systemHandlers as unknown as Record<string, MockFunction>,
    registries.systemHandlers
  );

  pluginHost.setSystemHandlerTable(allSystemHandlers);

  if (Object.keys(registries.sessionDataPatch).length) {
    merge(defaultSessionData, registries.sessionDataPatch);
  }

  sessions.setCookieName(config.session?.cookieName);
  const defaultSessionId = config.defaultSessionId ?? 'default';

  sessions.setDefaultSessionId(defaultSessionId);
  sessions.setAllowUnauthorized(Boolean(options.allowUnauthorized), defaultSessionId);

  if (options.allowUnauthorized) {
    log.warn(
      `⚠️ --allow-unauthorized: token/session-key checks are off, session "${defaultSessionId}" is used`
    );
  }

  sessions.createSession(
    structuredClone(defaultSessionData),
    defaultSessionId,
    config.session?.tokens
  );

  const protocol = sslEnabled ? 'https' : 'http';
  const needsSsl =
    protocol === 'https' ||
    Boolean(rawSocketsEnabled && config.rawSockets?.routes.some(({ secure }) => secure));
  const sslOptions =
    needsSsl && config.ssl
      ? {
          key: await readFile(path.resolve(configDirectory, config.ssl.key)),
          cert: await readFile(path.resolve(configDirectory, config.ssl.cert)),
        }
      : undefined;

  if (needsSsl && !config.ssl) {
    throw new Error('HTTPS/TLS requires ssl.key and ssl.cert in the config');
  }

  // CLI flag, then the config, then the environment (which is how the Vite
  // plugin hands over the port pair it reserved), then the default.
  const environment = getMockEnv();
  const host = options.host ?? config.server?.host ?? environment.host ?? '127.0.0.1';
  const port = options.port ?? config.server?.port ?? environment.port ?? DEFAULT_MOCK_BACKEND_PORT;
  const mockServer = createMockServer({
    host,
    port,
    protocol,
    handlers: registries.handlers,
    websockets: registries.websockets.length ? registries.websockets : undefined,
    websocketOptions: config.websocket?.echoSubprotocols
      ? { echoSubprotocols: config.websocket.echoSubprotocols }
      : undefined,
    extraSystemHandlers: registries.systemHandlers,
    sseHandlers: registries.sseHandlers.length ? registries.sseHandlers : undefined,
    sslOptions,
    rewritePath,
  });

  if (!mockServer.listening) {
    await once(mockServer, 'listening');
  }

  await pluginHost.callServerStarted(mockServer, { host, port, protocol });

  mockServer.once('close', () => {
    void pluginHost.dispose();
  });

  if (rawSocketsEnabled && config.rawSockets) {
    try {
      const rawSocketHandler = await resolveResource<MockerRawSocketHandler>(
        configDirectory,
        config.rawSockets.handler,
        'rawSockets.handler',
        validators.rawSocketHandler
      );
      const initialContext = sessions.getById(defaultSessionId);

      if (!initialContext) {
        throw new Error(`Default session "${defaultSessionId}" was not created`);
      }

      initialContext.setHandlers(registries.handlers);

      const rawSocketServer = await createRawSocketServer({
        greeting: config.rawSockets.greetingHex
          ? Buffer.from(config.rawSockets.greetingHex, 'hex')
          : undefined,
        handler: rawSocketHandler,
        host: config.rawSockets.host,
        initialContext,
        routes: config.rawSockets.routes,
        sslOptions: sslOptions
          ? {
              ...sslOptions,
              ...config.rawSockets.tls,
            }
          : undefined,
      });

      mockServer.once('close', () => {
        void rawSocketServer.close();
      });
    } catch (error) {
      mockServer.close();

      throw error;
    }
  }

  return mockServer;
};
