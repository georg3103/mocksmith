# @mocksmith/playwright

A Playwright fixture for [mocksmith](https://github.com/georg3103/mocksmith):
every test gets its own isolated mock session, and external requests are blocked
so tests never depend on the network.

```bash
npm install --save-dev @mocksmith/playwright
```

```ts
import { expect } from '@playwright/test';
import { mockTest } from '@mocksmith/playwright';

mockTest('serves session data', async ({ page, initMockContext }) => {
  await initMockContext(session);

  expect(await (await page.request.get('/api/profile')).json()).toMatchObject({ plan: 'pro' });
});
```

Point it at the running server with `MOCKSMITH_URI=http://127.0.0.1:3101`.

To apply scenarios in tests, add
[`@mocksmith/scenarios`](https://www.npmjs.com/package/@mocksmith/scenarios) and
import `applyScenario` from `@mocksmith/scenarios/playwright`.

## License

MIT
