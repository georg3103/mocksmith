import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

import type { MockContext } from '../context/context';
import type {
  MockerConfig,
  MockerWebsocketHandler,
  ResolvedMockerConfig,
  StartMockerOptions,
} from '../config/types';
import type { MockFunction, MockHandlers, MocksAPI, SseHandler } from '../types';

/**
 * Bumped whenever a hook's shape changes in a way plugins would notice. A
 * plugin declares the version it was written against and the host refuses to
 * load one it cannot serve, instead of failing in some obscure way later.
 * */
export const PLUGIN_API_VERSION = 1 as const;

export type PluginLogger = {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/** Read-only view of the session registry handed to plugins. */
export type SessionsFacade = {
  getById(id: string): MockContext | undefined;
  getDefaultSessionId(): string;
  getDefaultSession(): MockContext | undefined;
  listIds(): string[];
};

export type PluginConfigEnv = {
  configDirectory: string;
  configPath: string;
  serverUrl: string;
  options: StartMockerOptions;
};

/**
 * A handler for a system route contributed by a plugin.
 *
 * The generics are `any` deliberately: the plugin knows the shape of its own
 * request body and should be free to type it, which a bare `MockFunction` —
 * pinned to the empty defaults — refused, forcing an `as never` cast at every
 * call site.
 * */
export type PluginSystemHandler = MockFunction<any, any, any>;

export type PluginSetupContext = {
  readonly config: MockerConfig;
  readonly configDirectory: string;
  readonly configPath: string;
  readonly serverUrl: string;
  readonly options: StartMockerOptions;
  readonly logger: PluginLogger;

  /**
   * Adds mock handlers. Handlers from the user's config win over a plugin's by
   * default — pass `{ override: true }` when the plugin must take precedence.
   * */
  addHandlers(handlers: MockHandlers<MocksAPI>, opts?: { override?: boolean }): void;

  /**
   * Adds routes under /__mocks/api/. A key may be a bare name ('scenarios') or
   * a full path. Built-in routes cannot be replaced.
   * */
  addSystemHandlers(handlers: Record<string, PluginSystemHandler>): void;

  addSseHandlers(handlers: SseHandler[]): void;
  addWebsocketHandlers(handlers: MockerWebsocketHandler[]): void;

  /** Deep-merges into the default session data before that session is created. */
  patchDefaultSessionData(patch: object): void;

  /**
   * Calls a system endpoint in-process. Same signature as the HTTP transport
   * used by the CLI and the Playwright fixture, so the same code can drive all
   * three.
   * */
  callSystemApi<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T>;

  readonly sessions: SessionsFacade;

  /**
   * Imports a module the way the config does: a path relative to the config,
   * or a package name resolved from the user's project. TypeScript works
   * without a registered loader.
   * */
  loadModule<T = Record<string, unknown>>(specifier: string): Promise<T>;

  /** Per-server scratch space, namespaced by plugin name. */
  readonly store: Map<string, unknown>;

  onClose(fn: () => void | Promise<void>): void;
};

export type PluginServerContext = PluginSetupContext & {
  server: HttpServer | HttpsServer;
  url: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
};

export type PluginSessionContext = {
  context: MockContext;
  id: string;
  isDefault: boolean;
  isSystem: boolean;
  logger: PluginLogger;
};

export type PluginCliArg = {
  name: string;
  required?: boolean;
  variadic?: boolean;
  description?: string;
};

export type PluginCliOption = {
  /** commander syntax: '--no-reload', '--session <id>'. */
  flags: string;
  description?: string;
  defaultValue?: unknown;
};

/**
 * A CLI command described as data, so a plugin never depends on commander.
 * */
export type PluginCliCommand = {
  name: string;
  description?: string;
  args?: PluginCliArg[];
  options?: PluginCliOption[];
  commands?: PluginCliCommand[];
  /** `mocksmith scenario foo` becomes `mocksmith scenario apply foo`. */
  defaultSubcommand?: string;
  hidden?: boolean;
  action?: (
    ctx: PluginCliContext,
    args: Record<string, string | string[] | undefined>,
    options: Record<string, unknown>
  ) => void | Promise<void>;
};

export type PluginCliContext = {
  callApi<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T>;
  sessionId: string;
  getBaseUrl(): string;
  appUrl?: string;
  reloadApp(): Promise<void>;
  resolvedConfig?: ResolvedMockerConfig;
  configDirectory?: string;
  loadModule<T = Record<string, unknown>>(specifier: string): Promise<T>;
  log: PluginLogger;
};

export type MocksmithPlugin = {
  /** Unique; used for deduplication, log prefixes and the store namespace. */
  name: string;
  apiVersion?: typeof PLUGIN_API_VERSION;
  /** Ordering, as in vite: 'pre' runs first, 'post' last. */
  enforce?: 'pre' | 'post';

  /** Config parsed, resources not resolved yet — the place to amend the config. */
  config?(config: MockerConfig, env: PluginConfigEnv): void | Promise<void>;

  /** Resources resolved, server not created, default session not created yet. */
  setup?(ctx: PluginSetupContext): void | Promise<void>;

  /** The server is listening. */
  serverStarted?(ctx: PluginServerContext): void | Promise<void>;

  /**
   * A session was created — including the per-test ones from the Playwright
   * fixture. Runs synchronously and must not block: everything it needs
   * (setOverride, patchApiData) is synchronous too.
   * */
  sessionCreated?(ctx: PluginSessionContext): void;

  close?(): void | Promise<void>;

  /** Commands added to the `mocksmith` CLI when this plugin is configured. */
  cli?: PluginCliCommand[];
};

export type MocksmithPluginFactory<Options = void> = (options?: Options) => MocksmithPlugin;

/** How a plugin can be referenced from the config. */
export type MockerPluginEntry =
  | MocksmithPlugin
  | MocksmithPluginFactory<never>
  | string
  | { use: string; options?: unknown; enabled?: boolean };

/** Subset of StartMockerOptions the plugin layer passes through. */
export type StartMockerOptionsLike = StartMockerOptions;

export type MockerPluginDiscovery = {
  /** Off by default: a plugin runs because the config says so, not because it is installed. */
  auto?: boolean;
  patterns?: string[];
};
