import { APIRequestContext } from '@playwright/test';

import type { MockApiBase, SessionTokenType } from 'mocksmith/client';
import { getMockBackendUri } from './getMockBackendUri';

export const requestCreateMockContext = async (
  request: APIRequestContext,
  mocksAPI: MockApiBase,
  testId: string,
  tokens?: Partial<Record<SessionTokenType, string>>
) => {
  const url = new URL('/__mocks/api/createSession', getMockBackendUri()).href;
  const res = await request.post(url, { data: { mocksAPI, id: testId, tokens } });

  if (!res.ok()) {
    throw new Error(
      `Could not create a mock session (${res.status()} from ${url}): ${await res.text()}`
    );
  }

  const { cookieName, id } = (await res.json()) as { cookieName: string; id: string };

  return { cookieName, id };
};
