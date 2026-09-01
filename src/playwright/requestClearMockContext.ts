import { APIRequestContext } from '@playwright/test';

import { getMockBackendUri } from './getMockBackendUri';

export const requestClearMockContext = async (
  request: APIRequestContext,
  mockContextId: string
) => {
  await request.post(
    new URL('/__mocks/api/clearSession', getMockBackendUri()).href,
    {
      data: { id: mockContextId },
    }
  );
};
