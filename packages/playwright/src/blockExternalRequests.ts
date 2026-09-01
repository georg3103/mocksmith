import type { BrowserContext } from '@playwright/test';

import { getImageStub } from 'mocksmith/client';

// Matching at the pattern level avoids funnelling every request through route.continue()
const externalUrlPattern =
  /^https?:\/\/(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\[::1\])(?::\d+)?(?:\/|$))/i;

export const blockExternalRequests = async (context: BrowserContext) => {
  return context.route(externalUrlPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    // Header check (when the URL has no extension)
    const acceptHeader = request.headers()['accept'] || '';
    const looksLikeImage = acceptHeader.includes('image/');

    // Extension check for images
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);

    if (isImage || looksLikeImage) {
      const width = parseInt(url.searchParams.get('w') || '100');
      const height = parseInt(url.searchParams.get('h') || '100');
      const svg = getImageStub(width, height);

      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
      });
    } else {
      // eslint-disable-next-line no-console
      console.log(`Blocking an external request: ${request.url()}`);
      await route.abort();
    }
  });
};
