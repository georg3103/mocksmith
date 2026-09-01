import { getMockBackendUri, readSessionId } from '@mocksmith/playwright';
import type { Page } from '@playwright/test';

import { applyScenarioViaApi } from './applyScenarioViaApi';

import type { TestScenario } from './types';

/**
 * Applies a scenario to the session bound to this page — either a scenario
 * object, or the name of one registered on the server.
 *
 * Requires the mock session cookie, so `initMockContext` must have run first.
 * */
export async function applyScenario(
  page: Page,
  scenario: TestScenario | string
): Promise<void> {
  // The cookie name is configurable, so it is read back from the fixture
  // rather than assumed to be the default.
  const id = await readSessionId(page.context());

  if (!id) {
    throw new Error('applyScenario: no mock session cookie — initMockContext must run first');
  }

  const post = (endpoint: string, body: Record<string, unknown>) =>
    page.request.post(new URL(`/__mocks/api/${endpoint}`, getMockBackendUri()).href, {
      data: { ...body, id },
    });

  if (typeof scenario !== 'string') {
    await applyScenarioViaApi(scenario, post);

    return;
  }

  const response = await post('applyScenario', { name: scenario, clearExisting: true });

  if (!response.ok()) {
    throw new Error(
      `applyScenario("${scenario}") failed: ${response.status()} ${await response.text()}`
    );
  }
}
