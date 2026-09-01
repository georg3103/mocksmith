/**
 * The part of mocksmith that carries no server runtime: constants, small
 * helpers and the shared types.
 *
 * Companion packages (@mocksmith/playwright, @mocksmith/scenarios) import this
 * entry point instead of the root one, so a test worker never pulls in `ws`,
 * `jiti` or the HTTP server just to read a cookie name or a type.
 * */

export { CONTEXT_COOKIE_NAME, getContextIdFromCookie } from './utils/getContextFromCookie';
export { getImageStub, getImageStubUrl } from './utils/getImageStub';

export type { MockApiBase } from './context/context';
export type { SessionTokens, SessionTokenType } from './context/session';

export type {
  MockData,
  MockHeaders,
  MocksAPI,
  MocksRequestPayload,
  MocksResultData,
  OverrideListEntry,
  OverrideResponse,
  OverrideRule,
  QueryMatch,
} from './types';
