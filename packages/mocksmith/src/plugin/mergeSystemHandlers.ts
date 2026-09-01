import type { MockFunction } from '../types';

const SYSTEM_PREFIX = '/__mocks/api/';

/** A key may be a bare name ('scenarios') or the full route path. */
const toPath = (key: string) => (key.startsWith('/') ? key : `${SYSTEM_PREFIX}${key}`);

/**
 * Accumulates system routes contributed by plugins. Two plugins claiming the
 * same route is a configuration mistake worth failing on: whichever won would
 * depend on plugin order, which is exactly the kind of bug that shows up only
 * on someone else's machine.
 * */
export const addPluginSystemHandlers = (
  collected: Record<string, MockFunction>,
  incoming: Record<string, MockFunction>
): Record<string, MockFunction> => {
  const merged: Record<string, MockFunction> = { ...collected };

  for (const [key, handler] of Object.entries(incoming)) {
    const path = toPath(key);

    if (path in merged) {
      throw new Error(`Two plugins registered the same system route "${path}".`);
    }

    merged[path] = handler;
  }

  return merged;
};

/**
 * Merges plugin routes into the built-in ones. Replacing a built-in is refused:
 * the system API is the protocol the CLI and the test fixtures speak, and a
 * plugin quietly redefining `setOverride` would be near-impossible to debug.
 * */
export const mergeSystemHandlers = (
  base: Record<string, MockFunction>,
  extra?: Record<string, MockFunction>
): Record<string, MockFunction> => {
  if (!extra || Object.keys(extra).length === 0) {
    return base;
  }

  const merged: Record<string, MockFunction> = { ...base };

  for (const [key, handler] of Object.entries(extra)) {
    const path = toPath(key);

    if (path in base) {
      throw new Error(
        `A plugin tried to replace the built-in system route "${path}". ` +
          'Built-in routes are reserved — pick a different name.'
      );
    }

    merged[path] = handler;
  }

  return merged;
};
