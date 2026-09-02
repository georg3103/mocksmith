import { SystemApiError } from '../plugin/SystemApiError';

import type { MockContext } from '../context/context';
import type { MockData, MockFunction } from '../types';

const SYSTEM_PREFIX = '/__mocks/api/';

export type SystemApiCaller = <T = unknown>(
  endpoint: string,
  body: Record<string, unknown>
) => Promise<T>;

/**
 * Invokes a system route in-process, without going through HTTP. Plugins use
 * this to reuse the very same operations the CLI drives over the network
 * (`setOverride`, `patchSession`, …) instead of reimplementing them.
 *
 * A non-2xx answer throws `SystemApiError`, which carries the status and the
 * body. The HTTP transport lets a caller check `response.ok`; in-process there
 * is nothing to check, so silence would be the only report of a typo in a
 * session id.
 * */
export const createSystemApiCaller = (
  getHandlers: () => Record<string, MockFunction>,
  getContext: () => MockContext | undefined
): SystemApiCaller => {
  return async <T,>(endpoint: string, body: Record<string, unknown>): Promise<T> => {
    const path = endpoint.startsWith('/') ? endpoint : `${SYSTEM_PREFIX}${endpoint}`;
    const handler = getHandlers()[path];

    if (typeof handler !== 'function') {
      throw new Error(`Unknown system endpoint "${path}"`);
    }

    const context = getContext();

    if (!context) {
      throw new Error(`Cannot call "${path}": no session is available yet`);
    }

    const result = await handler(
      {},
      {
        context,
        name: path,
        requestData: { path, query: {}, body },
      },
      () => false
    );

    const response = (result as MockData | undefined)?.response;
    const status = response?.status ?? 200;

    if (status >= 400) {
      throw new SystemApiError(path, status, response?.body);
    }

    return response?.body as T;
  };
};
