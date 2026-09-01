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

    return (result as MockData | undefined)?.response?.body as T;
  };
};
