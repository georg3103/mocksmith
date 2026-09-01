import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SecureContextOptions } from 'node:tls';

import type { MockContext } from './context/context';

export interface MocksAPI {}

export interface MocksRequestPayload {}
export interface MocksResultData {}

export type MockHeaders = Record<string, string | string[] | undefined>;

export type WsBinaryType = 'nodebuffer' | 'arraybuffer' | 'fragments';

export interface MockData<T extends MocksResultData = MocksResultData> {
  request?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
  };
  response: {
    status?: number;
    headers?: {
      'content-type'?: string;
    } & MockHeaders;
    body?: T;
  };
}

export type OverrideResponse = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delay?: number;
  abort?: boolean;
};

export type QueryMatch = string | number;

/**
 * Override rule. A path can hold a list of rules — the first one whose
 * `when.query` matches wins. A rule without `when` always matches.
 * `responses` returns answers by call number (the last one repeats),
 * otherwise the single response described by the rule's own fields is used.
 * */
export type OverrideRule = OverrideResponse & {
  when?: { query?: Record<string, QueryMatch> };
  responses?: OverrideResponse[];
};

/**
 * Backwards compatibility: a single override is a single rule.
 * */
export type OverrideEntry = OverrideRule;

/**
 * An entry in the list of active overrides.
 * */
export type OverrideListEntry = { path: string; rules: OverrideRule[] };

export type RequestData<R extends MocksRequestPayload = MocksRequestPayload> = {
  path: string | null;
  query: unknown;
  body: R;
  urlParams?: any;
};

export type HandlerOptions<R extends MocksResultData = MocksResultData> = {
  context: MockContext;
  name: string;
  request: IncomingMessage;
  data: RequestData;
  sendToWebSocket: (data: R, delay?: number) => boolean;
};

export type Handler<R extends MocksResultData = MocksResultData> = (
  options: HandlerOptions<R>
) => Promise<MockData<R>> | Promise<unknown> | undefined;

export type SseHandlerFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  context: MockContext
) => void;

export type SseHandler = {
  handler: SseHandlerFunction;
  path: string;
};

export type ReqFunction = (
  context: MockContext,
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void | undefined>;

export type MockFunctionIncomingParams<R extends MocksRequestPayload> = {
  context: MockContext;
  request: IncomingMessage;
  name: string;
  requestData: RequestData<R>;
};

export type MockFunction<
  M extends MocksAPI = MocksAPI,
  R extends MocksRequestPayload = MocksRequestPayload,
  D extends MocksResultData = MocksResultData
> = (
  mockApi: M,
  params: MockFunctionIncomingParams<R>,
  sendToWebSocket: (data: D, delay?: number) => boolean
) => Promise<MockData<D>> | Promise<D> | D | undefined | void;

export type SslOptions = Pick<SecureContextOptions, 'key' | 'cert'>;

/**
 * Rewrites the incoming request path before the mock lookup.
 * Useful for clients whose URL shape differs from the one mock keys are
 * written in (e.g. a mobile gateway that prefixes or renames services).
 * Return `undefined` when the path needs no rewriting — it is then looked
 * up as is.
 * */
export type RewritePath = (path: string) => string | undefined;

export type MockHandlers<
  M extends MocksAPI,
  R extends MocksRequestPayload = MocksRequestPayload,
  D extends MocksResultData = MocksResultData
> = Record<string, MockFunction<M, R, D> | MockData<D> | undefined>;
