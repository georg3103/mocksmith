import log from 'loglevel';
import { IncomingMessage } from 'node:http';

import { CONTEXT_COOKIE_NAME, getContextIdFromCookie } from '../utils/getContextFromCookie';
import { MockContext } from './context';

export type MockApiBase = object;

export type SessionId = string;

// Reserved id of the default session: never expires
export const DEFAULT_SESSION_ID = 'default';

// Reserved id of the internal session serving the /__mocks/api routes
export const SYSTEM_SESSION_ID = 'system';

export type SessionCreatedMeta = { isDefault: boolean; isSystem: boolean };

export type SessionCreatedListener = (context: MockContext, meta: SessionCreatedMeta) => void;

export type SessionTokenType = 'access' | 'authorization' | 'refresh';

export type SessionTokens = Partial<Record<SessionTokenType, string>>;

class MockSessions {
  private contexts: Map<SessionId, MockContext> = new Map();

  private sessionKeys: Map<string, SessionId> = new Map();

  private tokens: Map<string, SessionId> = new Map();

  private sessionTokens: Map<SessionId, SessionTokens> = new Map();

  private sessionListeners: Set<SessionCreatedListener> = new Set();

  private sessionKeySequence = 0n;

  private cookieName = CONTEXT_COOKIE_NAME;

  private defaultSessionId: SessionId = DEFAULT_SESSION_ID;

  private tokenFallbackSessionId?: SessionId;

  public SESSION_LIFETIME_THRESHOLD = 30_000;

  private monitorInterval: NodeJS.Timeout | null = null;

  private readonly CHECK_INTERVAL = 10_000;

  constructor() {
    this.startMonitoring();
  }

  private startMonitoring() {
    this.monitorInterval = setInterval(() => {
      this.checkSessionLifetimes();
    }, this.CHECK_INTERVAL);
    this.monitorInterval.unref?.();
  }

  public createSession(mockParams: MockApiBase, id?: string, tokens?: SessionTokens) {
    const context = new MockContext(mockParams, id);
    const sessionId = context.id;

    if (this.contexts.has(sessionId)) {
      this.clearSession(sessionId);
    }

    this.contexts.set(context.id, context);

    if (tokens) {
      for (const [type, token] of Object.entries(tokens)) {
        if (token) {
          this.bindToken(context, type as SessionTokenType, token);
        }
      }
    }

    log.info(`➕ Session created = ${sessionId}`);
    log.debug(mockParams);

    this.notifySessionCreated(context, sessionId);

    return sessionId;
  }

  /**
   * Notifies listeners that a session appeared — including the per-test ones a
   * test fixture creates. Listeners run synchronously because createSession is
   * synchronous and sits on the hot path of every test; a failing listener is
   * logged rather than allowed to break session creation.
   * */
  public onSessionCreated(listener: SessionCreatedListener) {
    this.sessionListeners.add(listener);

    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  public listIds() {
    return [...this.contexts.keys()];
  }

  private notifySessionCreated(context: MockContext, sessionId: SessionId) {
    if (!this.sessionListeners.size) {
      return;
    }

    const meta = {
      isDefault: sessionId === this.defaultSessionId,
      isSystem: sessionId === SYSTEM_SESSION_ID,
    };

    for (const listener of this.sessionListeners) {
      try {
        listener(context, meta);
      } catch (error) {
        log.warn(`Session listener failed for "${sessionId}"`, error);
      }
    }
  }

  public setCookieName(cookieName?: string) {
    this.cookieName = cookieName || CONTEXT_COOKIE_NAME;
  }

  public getCookieName() {
    return this.cookieName;
  }

  public setDefaultSessionId(id: SessionId = DEFAULT_SESSION_ID) {
    this.defaultSessionId = id;
  }

  public getDefaultSessionId() {
    return this.defaultSessionId;
  }

  public getDefaultSession() {
    return this.getById(this.defaultSessionId);
  }

  /**
   * Local permissive mode: tokens and session keys are not verified,
   * all such connections are routed into the given default session.
   * */
  public setAllowUnauthorized(enabled: boolean, defaultSessionId = DEFAULT_SESSION_ID) {
    this.tokenFallbackSessionId = enabled ? defaultSessionId : undefined;
  }

  public getByRequest(req: IncomingMessage) {
    const id = getContextIdFromCookie(req, this.cookieName);

    if (id) {
      return this.getById(id);
    }

    const bearerToken = this.getBearerToken(req);

    if (bearerToken) {
      return this.getByToken(bearerToken);
    }
  }

  public getByRequestOrDefault(req: IncomingMessage) {
    const context = this.getByRequest(req);

    if (context) {
      return context;
    }

    if (this.getBearerToken(req) || getContextIdFromCookie(req, this.cookieName)) {
      return;
    }

    return this.getDefaultSession();
  }

  public getById(id: string) {
    return this.contexts.get(id);
  }

  public getByToken(token: string) {
    const fallbackContext = this.getTokenFallbackContext();

    if (fallbackContext) {
      return fallbackContext;
    }

    const sessionId = this.tokens.get(token);

    return sessionId ? this.getById(sessionId) : undefined;
  }

  /**
   * Looks a session up by an opaque key previously issued via `createSessionKey`.
   * Useful for protocols that authenticate with a handed-out key instead of a
   * cookie or bearer token.
   * */
  public getBySessionKey(key: bigint | number | string) {
    const fallbackContext = this.getTokenFallbackContext();

    if (fallbackContext) {
      return fallbackContext;
    }

    const sessionId = this.sessionKeys.get(String(key));

    return sessionId ? this.getById(sessionId) : undefined;
  }

  public bindToken(context: MockContext, type: SessionTokenType, token: string) {
    const previousToken = this.sessionTokens.get(context.id)?.[type];
    const existingSessionId = this.tokens.get(token);

    if (existingSessionId && existingSessionId !== context.id) {
      throw new Error(`Token already belongs to session ${existingSessionId}`);
    }

    if (previousToken && this.tokens.get(previousToken) === context.id) {
      this.tokens.delete(previousToken);
    }

    this.tokens.set(token, context.id);
    this.sessionTokens.set(context.id, {
      ...this.sessionTokens.get(context.id),
      [type]: token,
    });

    return token;
  }

  public getToken(context: MockContext, type: SessionTokenType) {
    return this.sessionTokens.get(context.id)?.[type];
  }

  /** Issues an opaque key bound to the session, see `getBySessionKey`. */
  public createSessionKey(context: MockContext) {
    this.sessionKeySequence += 1n;

    const key = this.sessionKeySequence;

    this.sessionKeys.set(String(key), context.id);

    return key;
  }

  public clearSession(id: SessionId) {
    this.contexts.delete(id);
    this.sessionTokens.delete(id);

    for (const [token, sessionId] of this.tokens) {
      if (sessionId === id) {
        this.tokens.delete(token);
      }
    }

    for (const [key, sessionId] of this.sessionKeys) {
      if (sessionId === id) {
        this.sessionKeys.delete(key);
      }
    }
  }

  private getBearerToken(req: IncomingMessage) {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    return match?.[1];
  }

  private getTokenFallbackContext() {
    return this.tokenFallbackSessionId ? this.getById(this.tokenFallbackSessionId) : undefined;
  }

  private checkSessionLifetimes() {
    const now = Date.now();
    const expiredSessions: { id: SessionId; lifetime: number }[] = [];

    this.contexts.forEach((sessionData, sessionId) => {
      const lifetime = now - Number(sessionData.createdAt);

      if (
        lifetime > 0 &&
        lifetime > this.SESSION_LIFETIME_THRESHOLD &&
        sessionId !== this.defaultSessionId
      ) {
        expiredSessions.push({
          id: sessionId,
          lifetime: Math.round(lifetime / 1000), // seconds
        });
      }
    });

    if (expiredSessions.length > 0) {
      log.warn(
        `⚠️  Sessions exceeding their expected lifetime (>${
          this.SESSION_LIFETIME_THRESHOLD / 1000
        }s):`
      );
      expiredSessions.forEach(({ id, lifetime }) => {
        log.warn(`   Session ID: ${id}, lifetime: ${lifetime}s`);
      });
    }
  }
}

export const sessions = new MockSessions();
