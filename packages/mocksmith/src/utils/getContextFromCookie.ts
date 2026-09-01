import { IncomingMessage } from 'node:http';

export const CONTEXT_COOKIE_NAME = '_mock_context_id';

export function getContextIdFromCookie(request: IncomingMessage, cookieName = CONTEXT_COOKIE_NAME) {
  const cookieString = request.headers.cookie;

  if (typeof cookieString !== 'string') {
    return;
  }

  const cookies = cookieString.split(';');

  const contextCookie = cookies.find((cookie) => cookie.trim().startsWith(`${cookieName}=`));

  if (contextCookie) {
    return contextCookie.trim().slice(cookieName.length + 1);
  }
}
