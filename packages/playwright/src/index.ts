import { test } from '@playwright/test';
import log from 'loglevel';

import type { MockApiBase } from 'mocksmith/client';
import { blockExternalRequests } from './blockExternalRequests';
import { requestClearMockContext } from './requestClearMockContext';
import { requestCreateMockContext } from './requestCreateMockContext';
import { rememberSessionCookieName } from './sessionCookie';

export { blockExternalRequests } from './blockExternalRequests';
export { requestCreateMockContext } from './requestCreateMockContext';
export { requestClearMockContext } from './requestClearMockContext';
export { getMockBackendUri } from './getMockBackendUri';
export { getSessionCookieName, readSessionId } from './sessionCookie';

/**
 * Base Playwright test wired to the mock server: each test gets an isolated
 * mock session (cookie-bound), external requests are blocked.
 *
 * The built-in `context` fixture is reused rather than replaced, so tracing,
 * video, screenshots and the project's own context options keep working.
 * */
export const mockTest = test.extend<{
  initMockContext: (mocksApi: MockApiBase) => Promise<void>;
}>({
  context: async ({ context }, use) => {
    await blockExternalRequests(context);

    await use(context);
  },
  initMockContext: [
    async ({ context, baseURL }, use) => {
      let mockContextId: string | undefined;

      // the call binds the browser context to the mock session via a cookie
      await use(async function initMocksContext(mocksAPI: MockApiBase) {
        if (!baseURL) {
          throw new Error(
            'initMockContext needs `use.baseURL` in your Playwright config: the mock ' +
              'session cookie is bound to the app origin.'
          );
        }

        const testInfo = test.info();

        const session = await requestCreateMockContext(
          context.request,
          mocksAPI,
          `${testInfo.testId}-repeatEachIndex:${testInfo.repeatEachIndex}-retry:${testInfo.retry}-workerIndex:${testInfo.workerIndex}-parallelIndex:${testInfo.parallelIndex}`
        );

        mockContextId = session.id;
        rememberSessionCookieName(context, session.cookieName);

        await context.addCookies([
          { name: session.cookieName, value: mockContextId, url: baseURL },
        ]);
      });

      // if the fixture was used, tear the mock session down
      if (mockContextId) {
        try {
          await requestClearMockContext(context.request, mockContextId);
        } catch (e) {
          log.warn('Failed to clear the mock session', e);
        }
      }
    },
    { scope: 'test', box: true },
  ],
});
