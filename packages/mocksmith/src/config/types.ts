import type { IncomingMessage } from 'node:http';
import type { SecureVersion } from 'node:tls';

import type { MockContext } from '../context/context';
import type { SessionTokens } from '../context/session';
import type { SocketConnection } from '../socketConnection';

import type { MockHandlers, MocksAPI, RewritePath, SseHandler } from '../types';
import type { MockerPluginDiscovery, MockerPluginEntry } from '../plugin/types';
import type { WebsocketMessageEncoder } from '../websocketEncoder';

export type MockerProtocol = 'http' | 'https';

export type MockServerRuntimeOptions = {
  host?: string;
  port?: number;
  protocol?: MockerProtocol;
  websocketFallback?: boolean;
};

export type MockerConfigResource<T> = string | T;

export type ConfigResourceValidator<T> = (value: unknown) => value is T;

export type MockerWebsocketHandler = {
  handler: unknown;
  path: string;
  sessionFromMessage?: boolean;
};

export type MockerRawSocketRoute = {
  path: string;
  port: number;
  secure?: boolean;
};

export type MockerRawSocketHandler = (
  context: MockContext,
  request: IncomingMessage,
  data: Buffer,
  connection: SocketConnection
) => unknown;

export type MockerRawSocketsConfig = {
  greetingHex?: string;
  handler: MockerConfigResource<MockerRawSocketHandler>;
  host?: string;
  routes: MockerRawSocketRoute[];
  tls?: {
    maxVersion?: SecureVersion;
    minVersion?: SecureVersion;
  };
};

export type MockerConfig = {
  client?: {
    appUrl?: string;
    sessionId?: string;
    url?: string;
  };
  defaultSessionData: MockerConfigResource<object>;
  defaultSessionId?: string;
  handlers: MockerConfigResource<MockHandlers<MocksAPI>>[];
  /**
   * Plugins to load: an inline plugin or factory, a module specifier
   * ('@mocksmith/scenarios/plugin', './my-plugin.ts'), or { use, options }.
   * */
  plugins?: MockerPluginEntry[];
  /** Opt-in discovery of plugins among the project's dependencies. */
  pluginDiscovery?: MockerPluginDiscovery;
  rawSockets?: MockerRawSocketsConfig;
  rewritePath?: MockerConfigResource<RewritePath>;
  session?: {
    cookieName?: string;
    tokens?: SessionTokens;
  };
  server?: {
    host?: string;
    port?: number;
    rawSockets?: boolean;
    ssl?: boolean;
  };
  websocket?: {
    /** Subprotocols echoed back on the 101 response when the client asks for them. */
    echoSubprotocols?: string[];
    /** Encoder for messages pushed via the sendToWebsocket system API (default: JSON). */
    encodeMessage?: MockerConfigResource<WebsocketMessageEncoder>;
  };
  sseHandlers?: MockerConfigResource<SseHandler[]>;
  ssl?: {
    cert: string;
    key: string;
  };
  websocketHandlers?: MockerConfigResource<MockerWebsocketHandler[]>;
};

export type MockerBaseConfig = Omit<MockerConfig, 'defaultSessionData' | 'handlers'>;

export type ResolvedMockerConfig = {
  config: MockerConfig;
  configDirectory: string;
  configPath: string;
  serverUrl: string;
};

export type StartMockerOptions = {
  allowUnauthorized?: boolean;
  host?: string;
  port?: number;
  rawSockets?: boolean;
  ssl?: boolean;
};
