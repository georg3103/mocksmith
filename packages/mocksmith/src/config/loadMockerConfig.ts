import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { importModule } from '../utils/importModule';

import type { SessionTokens } from '../context/session';
import type { MockerPluginDiscovery, MockerPluginEntry } from '../plugin/types';
import { configResourceValidation } from './resourceValidators';

import type { ConfigResourceValidator, MockerConfig, ResolvedMockerConfig } from './types';

const CONFIG_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.json', '.mjs', '.mts', '.ts']);
const { isRecord, validators } = configResourceValidation;

const readString = (value: unknown, field: string, required = false) => {
  if (value === undefined && !required) {
    return undefined;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
};

const readResource = <T>(
  value: unknown,
  field: string,
  allowInline: boolean,
  isInlineValue: ConfigResourceValidator<T>
): string | T => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (allowInline && isInlineValue(value)) {
    return value;
  }

  const expected = allowInline ? 'a path or an inline value' : 'a non-empty path';

  throw new Error(`${field} must be ${expected}`);
};

const readServer = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  const port = value.port;

  if (value.rawSockets !== undefined && typeof value.rawSockets !== 'boolean') {
    throw new Error(`${field}.rawSockets must be a boolean`);
  }

  if (value.ssl !== undefined && typeof value.ssl !== 'boolean') {
    throw new Error(`${field}.ssl must be a boolean`);
  }

  if (
    port !== undefined &&
    (!Number.isInteger(port) || Number(port) <= 0 || Number(port) > 65_535)
  ) {
    throw new Error(`${field}.port must be an integer between 1 and 65535`);
  }

  return {
    host: readString(value.host, `${field}.host`),
    port: port === undefined ? undefined : Number(port),
    rawSockets: value.rawSockets,
    ssl: value.ssl,
  };
};

const readPort = (value: unknown, field: string) => {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65_535) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }

  return Number(value);
};

const readSessionTokens = (value: unknown): SessionTokens | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('session.tokens must be an object');
  }

  const supportedTypes = ['access', 'authorization', 'refresh'] as const;
  const unknownType = Object.keys(value).find(
    (type) => !supportedTypes.includes(type as (typeof supportedTypes)[number])
  );

  if (unknownType) {
    throw new Error(`session.tokens contains an unknown type "${unknownType}"`);
  }

  return Object.fromEntries(
    supportedTypes.flatMap((type) => {
      const token = readString(value[type], `session.tokens.${type}`);

      return token ? [[type, token]] : [];
    })
  );
};

const readRawSockets = (value: unknown, allowInline: boolean): MockerConfig['rawSockets'] => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('rawSockets must be an object');
  }

  if (!Array.isArray(value.routes) || value.routes.length === 0) {
    throw new Error('rawSockets.routes must be a non-empty array');
  }

  const routes = value.routes.map((route, index) => {
    if (!isRecord(route)) {
      throw new Error(`rawSockets.routes[${index}] must be an object`);
    }

    if (route.secure !== undefined && typeof route.secure !== 'boolean') {
      throw new Error(`rawSockets.routes[${index}].secure must be a boolean`);
    }

    return {
      path: readString(route.path, `rawSockets.routes[${index}].path`, true) as string,
      port: readPort(route.port, `rawSockets.routes[${index}].port`),
      ...(route.secure !== undefined && { secure: route.secure }),
    };
  });
  const ports = routes.map(({ port }) => port);

  if (new Set(ports).size !== ports.length) {
    throw new Error('rawSockets.routes must not contain duplicate ports');
  }

  const greetingHex = readString(value.greetingHex, 'rawSockets.greetingHex');

  if (greetingHex && (!/^[\da-f]+$/i.test(greetingHex) || greetingHex.length % 2 !== 0)) {
    throw new Error('rawSockets.greetingHex must contain an even number of hex characters');
  }

  const tls = value.tls;

  if (tls !== undefined && !isRecord(tls)) {
    throw new Error('rawSockets.tls must be an object');
  }

  return {
    routes,
    handler: readResource(
      value.handler,
      'rawSockets.handler',
      allowInline,
      validators.rawSocketHandler
    ),
    host: readString(value.host, 'rawSockets.host'),
    greetingHex,
    ...(tls && {
      tls: {
        minVersion: readString(tls.minVersion, 'rawSockets.tls.minVersion'),
        maxVersion: readString(tls.maxVersion, 'rawSockets.tls.maxVersion'),
      },
    }),
  } as MockerConfig['rawSockets'];
};

/**
 * A plugin entry is either a module specifier, a { use, options } record, or —
 * outside JSON configs — an inline plugin object or factory.
 * */
const readPlugins = (value: unknown, allowInline: boolean): MockerPluginEntry[] => {
  if (!Array.isArray(value)) {
    throw new Error('plugins must be an array');
  }

  return value.map((entry, index) => {
    const field = `plugins[${index}]`;

    if (typeof entry === 'string' && entry.trim()) {
      return entry;
    }

    if (isRecord(entry) && typeof entry.use === 'string' && entry.use.trim()) {
      return {
        use: entry.use,
        options: entry.options,
        enabled: entry.enabled !== false,
      };
    }

    if (allowInline && typeof entry === 'function') {
      return entry as MockerPluginEntry;
    }

    if (allowInline && isRecord(entry) && typeof entry.name === 'string' && entry.name.trim()) {
      return entry as unknown as MockerPluginEntry;
    }

    throw new Error(
      `${field} must be a module specifier, { use, options } or an inline plugin`
    );
  });
};

const readPluginDiscovery = (value: unknown): MockerPluginDiscovery => {
  if (!isRecord(value)) {
    throw new Error('pluginDiscovery must be an object');
  }

  if (value.auto !== undefined && typeof value.auto !== 'boolean') {
    throw new Error('pluginDiscovery.auto must be a boolean');
  }

  if (
    value.patterns !== undefined &&
    (!Array.isArray(value.patterns) || value.patterns.some((p) => typeof p !== 'string'))
  ) {
    throw new Error('pluginDiscovery.patterns must be an array of strings');
  }

  return {
    ...(value.auto !== undefined && { auto: value.auto }),
    ...(value.patterns !== undefined && { patterns: value.patterns as string[] }),
  };
};

const parseConfig = (value: unknown, allowInline: boolean): MockerConfig => {
  if (!isRecord(value)) {
    throw new Error('The config must export an object');
  }

  if (!Array.isArray(value.handlers) || value.handlers.length === 0) {
    throw new Error('handlers must be a non-empty array');
  }

  const server = value.server;
  const client = value.client;
  const session = value.session;
  const ssl = value.ssl;

  if (client !== undefined && !isRecord(client)) {
    throw new Error('client must be an object');
  }

  if (ssl !== undefined && !isRecord(ssl)) {
    throw new Error('ssl must be an object');
  }

  if (session !== undefined && !isRecord(session)) {
    throw new Error('session must be an object');
  }

  const parsedServer = readServer(server, 'server');
  const rawSockets = readRawSockets(value.rawSockets, allowInline);
  const websocket = value.websocket;

  if (websocket !== undefined) {
    if (!isRecord(websocket)) {
      throw new Error('websocket must be an object');
    }

    if (
      websocket.echoSubprotocols !== undefined &&
      (!Array.isArray(websocket.echoSubprotocols) ||
        websocket.echoSubprotocols.some((protocol) => typeof protocol !== 'string'))
    ) {
      throw new Error('websocket.echoSubprotocols must be an array of strings');
    }
  }

  return {
    handlers: value.handlers.map((handler, index) =>
      readResource(handler, `handlers[${index}]`, allowInline, validators.handlers)
    ) as MockerConfig['handlers'],
    defaultSessionData: readResource(
      value.defaultSessionData,
      'defaultSessionData',
      allowInline,
      validators.defaultSessionData
    ),
    defaultSessionId: readString(value.defaultSessionId, 'defaultSessionId'),
    ...(rawSockets && { rawSockets }),
    ...(value.rewritePath !== undefined && {
      rewritePath: readResource(
        value.rewritePath,
        'rewritePath',
        allowInline,
        validators.rewritePath
      ),
    }),
    ...(value.websocketHandlers !== undefined && {
      websocketHandlers: readResource(
        value.websocketHandlers,
        'websocketHandlers',
        allowInline,
        validators.websocketHandlers
      ),
    }),
    ...(value.sseHandlers !== undefined && {
      sseHandlers: readResource(
        value.sseHandlers,
        'sseHandlers',
        allowInline,
        validators.sseHandlers
      ),
    }),
    ...(value.plugins !== undefined && { plugins: readPlugins(value.plugins, allowInline) }),
    ...(value.pluginDiscovery !== undefined && {
      pluginDiscovery: readPluginDiscovery(value.pluginDiscovery),
    }),
    ...(parsedServer && { server: parsedServer }),
    ...(isRecord(websocket) && {
      websocket: {
        ...(websocket.echoSubprotocols !== undefined && {
          echoSubprotocols: websocket.echoSubprotocols as string[],
        }),
        ...(websocket.encodeMessage !== undefined && {
          encodeMessage: readResource(
            websocket.encodeMessage,
            'websocket.encodeMessage',
            allowInline,
            validators.websocketEncoder
          ),
        }),
      },
    }),
    ...(client && {
      client: {
        appUrl: readString(client.appUrl, 'client.appUrl'),
        sessionId: readString(client.sessionId, 'client.sessionId'),
        url: readString(client.url, 'client.url'),
      },
    }),
    ...(session && {
      session: {
        cookieName: readString(session.cookieName, 'session.cookieName'),
        tokens: readSessionTokens(session.tokens),
      },
    }),
    ...(ssl && {
      ssl: {
        key: readString(ssl.key, 'ssl.key', true) as string,
        cert: readString(ssl.cert, 'ssl.cert', true) as string,
      },
    }),
  };
};

export const loadMockerConfig = async (
  configFile: string,
  cwd = process.cwd()
): Promise<ResolvedMockerConfig> => {
  const configPath = path.resolve(cwd, configFile);
  const extension = path.extname(configPath);

  if (!CONFIG_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported config format "${extension || 'none'}". ` +
        'Use .ts, .mts, .cts, .js, .mjs, .cjs or .json'
    );
  }

  let rawConfig: unknown;

  try {
    if (extension === '.json') {
      rawConfig = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    } else {
      const module = await importModule(configPath, pathToFileURL(configPath).href);

      if (!('default' in module)) {
        throw new Error('the config module must have a default export');
      }

      rawConfig = module.default;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to load config ${configPath}: ${message}`);
  }

  const config = parseConfig(rawConfig, extension !== '.json');
  const configDirectory = path.dirname(configPath);
  const port = config.server?.port ?? 3001;
  const protocol = config.server?.ssl ? 'https' : 'http';
  const clientHost =
    config.server?.host && config.server.host !== '0.0.0.0' ? config.server.host : 'localhost';

  return {
    config,
    configDirectory,
    configPath,
    serverUrl: config.client?.url ?? `${protocol}://${clientHost}:${port}`,
  };
};
