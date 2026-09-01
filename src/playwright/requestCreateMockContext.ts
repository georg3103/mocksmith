import { APIRequestContext } from '@playwright/test';

import { MockApiBase } from '../context/context';
import type { SessionTokenType } from '../context/session';
import { getMockBackendUri } from './getMockBackendUri';

export const requestCreateMockContext = async (
  request: APIRequestContext,
  mocksAPI: MockApiBase,
  testId: string,
  tokens?: Partial<Record<SessionTokenType, string>>
) => {
  const res = await request.post(new URL('/__mocks/api/createSession', getMockBackendUri()).href, {
    data: { mocksAPI, id: testId, tokens },
  });
  const { cookieName, id } = (await res.json()) as { cookieName: string; id: string };

  return { cookieName, id };
};
