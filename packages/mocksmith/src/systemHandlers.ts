import { MockApiBase } from './context/context';
import { sessions, type SessionTokenType } from './context/session';
import { revivePatchDate } from './utils/revivePatchDate';
import { encodeWebsocketMessages, type WebsocketOutgoingMessage } from './websocketEncoder';

import { MockData, MockFunction, MocksResultData, OverrideEntry, OverrideListEntry } from './types';

type WebsocketStateRequest = {
  id: string;
  path?: string;
};

type WebsocketCloseRequest = WebsocketStateRequest & {
  code?: number;
  reason?: string;
};

type WebsocketCloseResult = MocksResultData & {
  closed: number;
};

type WebsocketSendRequest = WebsocketStateRequest & {
  data: WebsocketOutgoingMessage | WebsocketOutgoingMessage[];
};

type WebsocketSendResult = MocksResultData & {
  sent: number;
};

const getSessionContext = (id: string) => {
  const context = sessions.getById(id);

  if (!context) {
    throw new Error(`Session ${id} not found`);
  }

  return context;
};

const createSessionHandler: MockFunction<
  {},
  {
    mocksAPI: unknown;
    id: string;
    tokens?: Partial<Record<SessionTokenType, string>>;
  },
  MockData<{ cookieName: string; id: string }>
> = async (_, { requestData }) => {
  const payload = requestData.body;
  const id = sessions.createSession(payload.mocksAPI as MockApiBase, payload.id, payload.tokens);

  return { response: { body: { cookieName: sessions.getCookieName(), id } } };
};

const clearSessionHandler: MockFunction<{}, { id: string }, MockData<{ result: 'ok' }>> = async (
  _,
  { requestData }
) => {
  sessions.clearSession(requestData.body.id);

  return { response: { body: { result: 'ok' } } };
};

const websocketStateHandler: MockFunction<
  {},
  WebsocketStateRequest,
  MockData<ReturnType<ReturnType<typeof getSessionContext>['getWebsocketDiagnostics']>>
> = async (_, { requestData }) => {
  const payload = requestData.body;
  const context = getSessionContext(payload.id);

  return { response: { body: context.getWebsocketDiagnostics(payload.path) } };
};

const websocketCloseHandler: MockFunction<
  {},
  WebsocketCloseRequest,
  MockData<WebsocketCloseResult>
> = async (_, { requestData }) => {
  const payload = requestData.body;
  const context = getSessionContext(payload.id);

  return {
    response: {
      body: {
        closed: context.closeWebsockets(payload.path, payload.code, payload.reason),
      },
    },
  };
};

const sendToWebsocketHandler: MockFunction<
  {},
  WebsocketSendRequest,
  MockData<WebsocketSendResult>
> = async (_, { requestData }) => {
  const payload = requestData.body;
  const context = getSessionContext(payload.id);
  const sockets = context.getWebsockets(payload.path);
  const buffer = await encodeWebsocketMessages(payload.data);

  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          socket.send(buffer, (error) => {
            if (error) {
              reject(error);

              return;
            }

            resolve();
          });
        })
    )
  );

  return {
    response: {
      body: {
        sent: sockets.length,
      },
    },
  };
};

type SystemPayload = { id?: string; patch?: object };

const resolveSessionId = (id?: string) => id ?? sessions.getDefaultSessionId();

// Mutates apiData of an existing session without restarting the server.
const patchSessionHandler: MockFunction<
  {},
  {},
  MockData<{ result: 'ok' | 'not-found' | 'bad-request' }>
> = async (_, { requestData }) => {
  const { id, patch } = requestData.body as SystemPayload;
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  if (!patch) {
    return { response: { status: 400, body: { result: 'bad-request' } } };
  }

  // Revive Date instances from ISO strings
  context.patchApiData(revivePatchDate(patch));

  return { response: { body: { result: 'ok' } } };
};

const getSessionHandler: MockFunction<{}, {}, MockData<Record<string, unknown>>> = async (
  _,
  { requestData }
) => {
  const { id } = requestData.body as SystemPayload;
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  return { response: { body: context.getApiData() as Record<string, unknown> } };
};

const resetSessionHandler: MockFunction<{}, {}, MockData<{ result: 'ok' | 'not-found' }>> = async (
  _,
  { requestData }
) => {
  const { id } = requestData.body as SystemPayload;
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  context.resetApiData();

  return { response: { body: { result: 'ok' } } };
};

// Endpoint response overrides (CLI: `endpoint set`)
const setOverrideHandler: MockFunction<
  {},
  {},
  MockData<{ result: 'ok' | 'not-found' | 'bad-request' }>
> = async (_, { requestData }) => {
  const { id, path, rules, ...entry } = requestData.body as SystemPayload &
    OverrideEntry & { path?: string; rules?: OverrideEntry[] };
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  if (!path) {
    return { response: { status: 400, body: { result: 'bad-request' } } };
  }

  context.setOverride(path, rules ?? entry);

  return { response: { body: { result: 'ok' } } };
};

const clearOverrideHandler: MockFunction<{}, {}, MockData<{ result: 'ok' | 'not-found' }>> = async (
  _,
  { requestData }
) => {
  const { id, path, all } = requestData.body as SystemPayload & {
    path?: string;
    all?: boolean;
  };
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  if (all) {
    context.clearOverrides();
  } else if (path) {
    context.clearOverride(path);
  }

  return { response: { body: { result: 'ok' } } };
};

const getOverridesHandler: MockFunction<
  {},
  {},
  MockData<OverrideListEntry[] | { result: 'not-found' }>
> = async (_, { requestData }) => {
  const { id } = requestData.body as SystemPayload;
  const context = sessions.getById(resolveSessionId(id));

  if (!context) {
    return { response: { status: 404, body: { result: 'not-found' } } };
  }

  return { response: { body: context.listOverrides() } };
};

export const systemHandlers = {
  '/__mocks/api/createSession': createSessionHandler,
  '/__mocks/api/clearSession': clearSessionHandler,
  '/__mocks/api/patchSession': patchSessionHandler,
  '/__mocks/api/getSession': getSessionHandler,
  '/__mocks/api/resetSession': resetSessionHandler,
  '/__mocks/api/setOverride': setOverrideHandler,
  '/__mocks/api/clearOverride': clearOverrideHandler,
  '/__mocks/api/getOverrides': getOverridesHandler,
  '/__mocks/api/sendToWebsocket': sendToWebsocketHandler,
  '/__mocks/api/websockets/state': websocketStateHandler,
  '/__mocks/api/websockets/close': websocketCloseHandler,
};
