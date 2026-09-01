import { test } from '@playwright/test';
import log from 'loglevel';

import type { MockApiBase } from 'mocksmith/client';
import { blockExternalRequests } from './blockExternalRequests';
import { requestClearMockContext } from './requestClearMockContext';
import { requestCreateMockContext } from './requestCreateMockContext';

export { blockExternalRequests } from './blockExternalRequests';
export { requestCreateMockContext } from './requestCreateMockContext';
export { requestClearMockContext } from './requestClearMockContext';
export { getMockBackendUri } from './getMockBackendUri';

/**
 * Base Playwright test wired to the mock server: each test gets an isolated
 * mock session (cookie-bound), external requests are blocked.
 * */
export const mockTest = test.extend<{
  forEachTest: void;
  initMockContext: (mocksApi: MockApiBase) => Promise<void>;
}>({
  context: async ({ browser }, Use, testInfo) => {
    const timezoneId = testInfo.project?.use?.timezoneId;

    const context = await browser.newContext({ timezoneId });

    await blockExternalRequests(context);

    await Use(context);
    await context.close();
  },
  initMockContext: [
    async ({ context, baseURL }, use) => {
      let mockContextId;

      // the call binds the browser context to the mock session via a cookie
      await use(async function initMocksContext(mocksAPI: MockApiBase) {
        const testInfo = test.info();

        const session = await requestCreateMockContext(
          context.request,
          mocksAPI,
          `${testInfo.testId}-repeatEachIndex:${testInfo.repeatEachIndex}-retry:${testInfo.retry}-workerIndex:${testInfo.workerIndex}-parallelIndex:${testInfo.parallelIndex}`
        );

        mockContextId = session.id;

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
