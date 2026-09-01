import { IncomingMessage } from 'node:http';

import { sessions } from './session';

const request = (headers: IncomingMessage['headers']) => ({ headers } as IncomingMessage);

describe('sessions', () => {
  const sessionIds: string[] = [];

  afterEach(() => {
    sessionIds.forEach((id) => sessions.clearSession(id));
    sessionIds.length = 0;
    sessions.setAllowUnauthorized(false);
    sessions.setCookieName();
    sessions.setDefaultSessionId();
  });

  const createSession = (id: string, tokens?: { access?: string; refresh?: string }) => {
    sessionIds.push(id);
    sessions.createSession({}, id, tokens);

    const context = sessions.getById(id);

    if (!context) {
      throw new Error(`Session ${id} was not created`);
    }

    return context;
  };

  test('matches a web session by the configured cookie name', () => {
    const context = createSession('cookie-session');

    sessions.setCookieName('terminal-session');

    expect(
      sessions.getByRequest(request({ cookie: 'other=x; terminal-session=cookie-session' }))
    ).toBe(context);
  });

  test('matches a mobile session by a bearer access or refresh token', () => {
    const context = createSession('mobile-session', {
      access: 'mobile-access',
      refresh: 'mobile-refresh',
    });

    expect(sessions.getByRequest(request({ authorization: 'Bearer mobile-access' }))).toBe(context);
    expect(sessions.getByRequest(request({ authorization: 'bearer mobile-refresh' }))).toBe(
      context
    );
  });

  test('prefers the cookie web session over a bearer token', () => {
    const webContext = createSession('web-session');

    createSession('bearer-session', { access: 'service-token' });

    expect(
      sessions.getByRequest(
        request({
          authorization: 'Bearer service-token',
          cookie: '_mock_context_id=web-session',
        })
      )
    ).toBe(webContext);
  });

  test('does not fall back to the bearer token when the cookie session is unknown', () => {
    createSession('bearer-session', { access: 'mobile-access' });

    expect(
      sessions.getByRequestOrDefault(
        request({
          authorization: 'Bearer mobile-access',
          cookie: '_mock_context_id=unknown-session',
        })
      )
    ).toBeUndefined();
  });

  test('does not substitute the default session for an unknown bearer token', () => {
    createSession('default');

    expect(
      sessions.getByRequestOrDefault(request({ authorization: 'Bearer unknown-token' }))
    ).toBeUndefined();
  });

  test('--allow-unauthorized routes any bearer token into the default session', () => {
    const defaultContext = createSession('default');

    createSession('another-session', { access: 'known-other-token' });
    sessions.setAllowUnauthorized(true);

    expect(sessions.getByRequest(request({ authorization: 'Bearer unknown-token' }))).toBe(
      defaultContext
    );
    expect(sessions.getByRequest(request({ authorization: 'Bearer known-other-token' }))).toBe(
      defaultContext
    );
  });

  test('--allow-unauthorized routes any session key into the default session', () => {
    const defaultContext = createSession('default');
    const anotherContext = createSession('another-session');
    const sessionKey = sessions.createSessionKey(anotherContext);

    sessions.setAllowUnauthorized(true);

    expect(sessions.getBySessionKey(sessionKey)).toBe(defaultContext);
    expect(sessions.getBySessionKey(999n)).toBe(defaultContext);
  });

  test('matches a connection by its session key', () => {
    const context = createSession('socket-session');
    const sessionKey = sessions.createSessionKey(context);

    expect(sessions.getBySessionKey(sessionKey)).toBe(context);
  });

  test('uses the configured default session for requests with no identifier', () => {
    const context = createSession('ios');

    sessions.setDefaultSessionId('ios');

    expect(sessions.getByRequestOrDefault(request({}))).toBe(context);
    expect(sessions.getDefaultSession()).toBe(context);
  });
});
