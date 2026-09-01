import { Page } from '@playwright/test';

import { applyScenarioViaApi } from '../scenario/applyScenarioViaApi';
import { CONTEXT_COOKIE_NAME } from '../utils/getContextFromCookie';
import { getMockBackendUri } from './getMockBackendUri';

import type { TestScenario } from '../scenario/types';

export async function applyScenario(page: Page, scenario: TestScenario): Promise<void> {
  const cookies = await page.context().cookies();
  const id = cookies.find((cookie) => cookie.name === CONTEXT_COOKIE_NAME)?.value;

  if (!id) {
    throw new Error(
      'applyScenario: no mock session cookie — initMockContext must run first'
    );
  }

  await applyScenarioViaApi(scenario, async (endpoint, body) => {
    return page.request.post(new URL(`/__mocks/api/${endpoint}`, getMockBackendUri()).href, {
      data: { ...body, id },
    });
  });
}
