import log from 'loglevel';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sessions } from '../context/session';
import { createMockServer } from '../createMockServer';
import { createRawSocketServer } from '../createRawSocketServer';
import { setWebsocketMessageEncoder, type WebsocketMessageEncoder } from '../websocketEncoder';
import { loadConfigResource } from './loadConfigResource';
import { configResourceValidation } from './resourceValidators';

import type { MockHandlers, MocksAPI, RewritePath, SseHandler } from '../types';
import type {
  ConfigResourceValidator,
  MockerConfigResource,
  MockerRawSocketHandler,
  MockerWebsocketHandler,
  ResolvedMockerConfig,
  StartMockerOptions,
} from './types';

const { validators } = configResourceValidation;

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

  const host = options.host ?? config.server?.host ?? '127.0.0.1';
  const port = options.port ?? config.server?.port ?? 3001;
  const mockServer = createMockServer({
    host,
    port,
    protocol,
    handlers,
    websockets,
    websocketOptions: config.websocket?.echoSubprotocols
      ? { echoSubprotocols: config.websocket.echoSubprotocols }
      : undefined,
    sseHandlers,
    sslOptions,
    rewritePath,
  });

  if (rawSocketsEnabled && config.rawSockets) {
    if (!mockServer.listening) {
      await once(mockServer, 'listening');
    }

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

      initialContext.setHandlers(handlers);

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
