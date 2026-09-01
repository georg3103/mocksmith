import { CONTEXT_COOKIE_NAME } from 'mocksmith/client';

import type { BrowserContext } from '@playwright/test';

/**
 * The cookie name the server actually uses, remembered per browser context.
 *
 * The name is configurable (`session.cookieName`), and only the server knows
 * it, so anything reading the cookie later — applyScenario, for one — has to
 * ask rather than assume the default.
 * */
const names = new WeakMap<BrowserContext, string>();

export const rememberSessionCookieName = (context: BrowserContext, cookieName: string) => {
  names.set(context, cookieName);
};

export const getSessionCookieName = (context: BrowserContext) =>
  names.get(context) ?? CONTEXT_COOKIE_NAME;

/** Reads the mock session id bound to this browser context, if any. */
export const readSessionId = async (context: BrowserContext) => {
  const cookieName = getSessionCookieName(context);
  const cookies = await context.cookies();

  return cookies.find((cookie) => cookie.name === cookieName)?.value;
};
