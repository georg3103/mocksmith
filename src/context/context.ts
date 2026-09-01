import merge from 'lodash.merge';
import { match } from 'path-to-regexp';

import { mockHandler } from '../proxyHandlers/mockHandler';
import {
  SOCKET_CLOSED,
  SOCKET_CLOSING,
  type SocketConnection,
  type SocketTransport,
} from '../socketConnection';
import { findHandlerKey } from '../utils/findHandlerKey';
import { generateHash } from '../utils/utils';

import {
  HandlerOptions,
  MockHandlers,
  MocksAPI,
  MocksRequestPayload,
  MocksResultData,
  OverrideListEntry,
  OverrideResponse,
  OverrideRule,
  QueryMatch,
} from '../types';

type Query = Record<string, string | string[] | undefined>;

/**
 * Whether an actual query parameter matches the expectation (an exact value
 * or an operator). For repeated parameters (?status=a&status=b) only the first
 * value is considered — matching across array values is not supported.
 * */
const matchQueryValue = (
  actualRaw: string | string[] | undefined,
  expected: QueryMatch
): boolean => {
  const actual = Array.isArray(actualRaw) ? actualRaw[0] : actualRaw;

  if (actual === undefined) {
    return false;
  }

  const exp = String(expected).trim();
  const operator = exp.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);

  if (operator) {
    const [, op, numStr] = operator;
    const a = Number(actual);

    if (Number.isNaN(a)) {
      return false;
    }

    const b = Number(numStr);

    switch (op) {
      case '>=':
        return a >= b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '<':
        return a < b;
      default:
        return a === b;
    }
  }

  return String(actual) === exp;
};

/**
 * Whether a rule matches the actual query (a rule without a condition always matches).
 * */
const matchQuery = (spec: OverrideRule['when'], query: Query): boolean => {
  if (!spec?.query) {
    return true;
  }

  return Object.entries(spec.query).every(([key, expected]) =>
    matchQueryValue(query[key], expected)
  );
};

export type MockApiBase = {};

export type ContextId = string;

type WebsocketConnection = {
  active: boolean;
  closeCode?: number;
  closeReason?: string;
  closedAt?: string;
  id: number;
  openedAt: string;
  path: string;
  transport: SocketTransport;
  ws: SocketConnection;
};

type WebsocketConnectionDiagnostics = Omit<WebsocketConnection, 'ws'>;

type WebsocketMessage = {
  connectionId?: number;
  dataFlowType?: number;
  flowKeys?: number[];
  id: number;
  path: string;
  receivedAt: string;
  subscribeType?: number;
  type?: number | string;
};

type WebsocketMessagePayload = {
  data?: unknown;
  type?: unknown;
};

export type WebsocketDiagnostics = {
  connections: WebsocketConnectionDiagnostics[];
  messages: WebsocketMessage[];
  paths: Record<
    string,
    {
      active: number;
      closed: number;
      lastConnectionId: number;
      total: number;
    }
  >;
};

export class MockContext {
  public id: ContextId;

  public createdAt: Date;

  private apiData: MockApiBase;

  // Snapshot of the initial state, used by resetApiData
  private readonly initialApiData: MockApiBase;

  private websockets: Map<string, SocketConnection> = new Map();

  private websocketConnections: Map<number, WebsocketConnection> = new Map();

  private websocketConnectionIdsByPath: Map<string, Set<number>> = new Map();

  private websocketConnectionIdsBySocket: WeakMap<SocketConnection, number> = new WeakMap();

  private websocketConnectionId = 0;

  private websocketMessages: WebsocketMessage[] = [];

  private websocketMessageId = 0;

  private handlers: MockHandlers<MocksAPI> = {};

  private contextData: Record<string, unknown> = {};

  // Endpoint response overrides (CLI `endpoint set` / scenarios). Kept apart
  // from handlers because setHandlers replaces this.handlers on every request.
  // Each path holds a list of rules; the first one matching the query wins.
  private overrides: Map<string, OverrideRule[]> = new Map();

  private overrideCounts: Map<string, number> = new Map();

  constructor(mockParams: MockApiBase, id?: string) {
    this.apiData = mockParams;
    this.initialApiData = structuredClone(mockParams);
    this.createdAt = new Date();
    this.id = id ?? generateHash(JSON.stringify(mockParams));
  }

  public setData<D>(key: string, data: D) {
    if (!this.contextData[key]) {
      this.contextData[key] = data;
    }

    return this.contextData[key] as D;
  }

  public getData<T>(key: string): T | undefined {
    return this.contextData[key] as T;
  }

  public setHandlers<M extends MockApiBase, P extends MocksRequestPayload>(
    handlers: MockHandlers<M, P>
  ) {
    // @ts-expect-error TODO: tighten this type
    this.handlers = handlers;
  }

  public getHandlers() {
    return this.handlers;
  }

  public getHandler(name: string) {
    const handler = this.handlers[name];

    if (handler) {
      return { handler };
    }

    const found = findHandlerKey(Object.keys(this.handlers), name);

    if (!found) {
      return;
    }

    return {
      handler: this.handlers[found.key],
      params: found.params,
    };
  }

  public setWebscoket(name: string, ws: SocketConnection) {
    this.websockets.set(name, ws);
  }

  /**
   * Registers a physical websocket connection so tests can inspect it later.
   * The snapshot keeps the connection history per path and updates on close.
   * */
  public registerWebsocket(path: string, ws: SocketConnection) {
    return this.registerSocket(path, ws, 'websocket');
  }

  /**
   * Registers a physical connection regardless of its transport.
   * */
  public registerSocket(path: string, ws: SocketConnection, transport: SocketTransport) {
    const id = ++this.websocketConnectionId;
    const connection: WebsocketConnection = {
      active: true,
      id,
      openedAt: new Date().toISOString(),
      path,
      transport,
      ws,
    };
    const connectionIds = this.websocketConnectionIdsByPath.get(path) ?? new Set<number>();

    connectionIds.add(id);
    this.websocketConnectionIdsByPath.set(path, connectionIds);
    this.websocketConnections.set(id, connection);
    this.websocketConnectionIdsBySocket.set(ws, id);
    this.setWebscoket(path, ws);

    ws.once('close', (code?: number, reason?: Buffer) => {
      this.markWebsocketClosed(connection, code, reason?.toString());
    });

    return id;
  }

  /**
   * Use this to reach a socket connection outside a websocket handler
   * (for example, from an HTTP endpoint mock).
   * */
  public getWebscoket(name: string) {
    return this.websockets.get(name);
  }

  /**
   * Returns the active websocket connections for a path, or for every path of
   * this mock context. Used to push data into specific open clients.
   * */
  public getWebsockets(path?: string) {
    return this.getConnections(path)
      .filter((connection) => connection.active)
      .map((connection) => connection.ws);
  }

  /**
   * Records incoming websocket entities compactly, without the full payload,
   * so e2e tests can assert on subscribe/unsubscribe and request traffic.
   * */
  public recordWebsocketMessages(
    path: string,
    ws: SocketConnection,
    messages: WebsocketMessagePayload[]
  ) {
    this.recordSocketMessages(path, ws, messages);
  }

  /**
   * Records incoming protocol entities for both WebSocket and raw sockets.
   * */
  public recordSocketMessages(
    path: string,
    ws: SocketConnection,
    messages: WebsocketMessagePayload[]
  ) {
    const connectionId = this.websocketConnectionIdsBySocket.get(ws);

    messages.forEach((message) => {
      this.websocketMessages.push({
        ...this.pickMessageDiagnostics(message),
        connectionId,
        id: ++this.websocketMessageId,
        path,
        receivedAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Returns a diagnostic snapshot of websocket connections, holding no
   * references to the socket objects themselves. Tests use it to assert on the
   * number of physical connections, reconnects and closed tabs.
   * */
  public getWebsocketDiagnostics(path?: string): WebsocketDiagnostics {
    const connections = this.getConnections(path).map<WebsocketConnectionDiagnostics>(
      ({ ws: _ws, ...connection }) => connection
    );
    const paths = connections.reduce<WebsocketDiagnostics['paths']>((acc, connection) => {
      const pathStats = acc[connection.path] ?? {
        active: 0,
        closed: 0,
        lastConnectionId: connection.id,
        total: 0,
      };

      pathStats.total += 1;
      pathStats.lastConnectionId = Math.max(pathStats.lastConnectionId, connection.id);

      if (connection.active) {
        pathStats.active += 1;
      } else {
        pathStats.closed += 1;
      }

      acc[connection.path] = pathStats;

      return acc;
    }, {});

    return {
      connections,
      messages: this.websocketMessages.filter((message) => !path || message.path === path),
      paths,
    };
  }

  /**
   * Closes the active websocket connections of a path, or of the whole context.
   * Returns how many connections were asked to close.
   * */
  public closeWebsockets(path?: string, code = 1000, reason = 'mock close') {
    let closedCount = 0;

    this.getConnections(path).forEach((connection) => {
      if (!connection.active) {
        return;
      }

      this.markWebsocketClosed(connection, code, reason);
      closedCount += 1;

      if (
        connection.ws.readyState !== SOCKET_CLOSED &&
        connection.ws.readyState !== SOCKET_CLOSING
      ) {
        connection.ws.close(code, reason);
      }
    });

    return closedCount;
  }

  public getApiData() {
    return this.apiData;
  }

  /**
   * Deep-merges a partial into the session apiData (runtime control from the CLI).
   * */
  public patchApiData(partial: Partial<MockApiBase>) {
    merge(this.apiData, partial);

    return this.apiData;
  }

  /**
   * Restores apiData from the snapshot and drops endpoint overrides
   * (a full session reset).
   * */
  public resetApiData() {
    this.apiData = structuredClone(this.initialApiData);
    this.overrides.clear();
    this.overrideCounts.clear();

    return this.apiData;
  }

  /**
   * Sets a runtime response override for a path. Accepts one rule or a list
   * of rules (the first one matching `when.query` wins).
   * Resets the `responses` call counters for that path.
   * */
  public setOverride(path: string, entry: OverrideRule | OverrideRule[]) {
    this.overrides.set(path, Array.isArray(entry) ? entry : [entry]);
    this.resetOverrideCounts(path);
  }

  public clearOverride(path: string) {
    this.overrides.delete(path);
    this.resetOverrideCounts(path);
  }

  public clearOverrides() {
    this.overrides.clear();
    this.overrideCounts.clear();
  }

  public listOverrides(): OverrideListEntry[] {
    return [...this.overrides.entries()].map(([path, rules]) => ({
      path,
      rules,
    }));
  }

  private resetOverrideCounts(path: string) {
    for (const key of this.overrideCounts.keys()) {
      if (key.startsWith(`${path}::`)) {
        this.overrideCounts.delete(key);
      }
    }
  }

  /**
   * Finds the override response for a path, taking the query into account:
   * an exact path match first, then path-to-regexp over the keys (like
   * getHandler, so patterns such as /a/:id are overridable too).
   * Among a path's rules the first one whose `when.query` matched wins; with
   * `responses` the answer is picked by call number (the last one repeats).
   * */
  public getOverride(name: string, query: Query = {}): OverrideResponse | undefined {
    const key = this.overrides.has(name)
      ? name
      : [...this.overrides.keys()].find((keyItem) => match(keyItem)(name));

    if (!key) {
      return undefined;
    }

    const rules = this.overrides.get(key) ?? [];
    const ruleIndex = rules.findIndex((rule) => matchQuery(rule.when, query));

    if (ruleIndex === -1) {
      return undefined;
    }

    const { when: _when, responses, ...response } = rules[ruleIndex];

    if (responses?.length) {
      const counterKey = `${key}::${ruleIndex}`;
      const count = this.overrideCounts.get(counterKey) ?? 0;

      this.overrideCounts.set(counterKey, count + 1);

      return responses[Math.min(count, responses.length - 1)];
    }

    return response;
  }

  public async processMock<D extends MocksResultData = MocksResultData>(
    options: Omit<HandlerOptions<D>, 'context'>
  ) {
    return mockHandler({
      context: this,
      ...options,
    });
  }

  private getConnections(path?: string) {
    if (!path) {
      return [...this.websocketConnections.values()];
    }

    const connectionIds = this.websocketConnectionIdsByPath.get(path);

    if (!connectionIds) {
      return [];
    }

    return [...connectionIds]
      .map((id) => this.websocketConnections.get(id))
      .filter((connection): connection is WebsocketConnection => Boolean(connection));
  }

  private markWebsocketClosed(connection: WebsocketConnection, code?: number, reason?: string) {
    if (!connection.active) {
      return;
    }

    connection.active = false;
    connection.closedAt = new Date().toISOString();
    connection.closeCode = code;
    connection.closeReason = reason;
  }

  private pickMessageDiagnostics(message: WebsocketMessagePayload) {
    const data = this.getRecord(message.data);
    const flowKeys = Array.isArray(data?.FlowKeys)
      ? data.FlowKeys.filter((flowKey): flowKey is number => typeof flowKey === 'number')
      : undefined;

    return {
      dataFlowType: typeof data?.DataFlowType === 'number' ? data.DataFlowType : undefined,
      flowKeys,
      subscribeType: typeof data?.SubscribeType === 'number' ? data.SubscribeType : undefined,
      type:
        typeof message.type === 'string' || typeof message.type === 'number'
          ? message.type
          : undefined,
    };
  }

  private getRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    return value as Record<string, unknown>;
  }
}
