import * as http from 'http';
import * as https from 'https';
import log from 'loglevel';
import { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

import { MockContext } from './context/context';
import { sessions, SYSTEM_SESSION_ID } from './context/session';
import { createWebSocketServer, CreateWebSocketServerOptions } from './createWebSocketServer';
import { getMockEnv } from './env';
import { mergeSystemHandlers } from './plugin/mergeSystemHandlers';
import { requestHandler } from './proxyHandlers/requestHandler';
import { systemHandlers } from './systemHandlers';

import type { MockServerRuntimeOptions } from './config/types';
import { MockFunction, MockHandlers, MocksAPI, RewritePath, SseHandler, SslOptions } from './types';

log.setLevel(getMockEnv().logLevel);

type MockServerOptionsWebsockets = {
  handler: unknown;
  path: string;
  sessionFromMessage?: boolean;
}[];
type WebSocketHandler = Parameters<typeof createWebSocketServer>[2];

type MockServerOptions<M extends MocksAPI> = MockServerRuntimeOptions & {
  port?: number;
  handlers: MockHandlers<M>;
  websockets?: MockServerOptionsWebsockets;
  websocketOptions?: CreateWebSocketServerOptions;
  /** Extra /__mocks/api routes contributed by plugins. Built-ins win. */
  extraSystemHandlers?: Record<string, MockFunction>;
  sseHandlers?: SseHandler[];
  defaultContext?: MockContext;
  sslOptions?: SslOptions | (() => SslOptions);
  rewritePath?: RewritePath;
};

export const createMockServer = <M extends MocksAPI>({
  host,
  port = getMockEnv().backendPort,
  protocol,
  websocketFallback = false,
  handlers,
  websockets,
  websocketOptions,
  extraSystemHandlers,
  sseHandlers,
  sslOptions,
  rewritePath,
}: MockServerOptions<M>) => {
  const allSystemHandlers = mergeSystemHandlers(
    systemHandlers as unknown as Record<string, MockFunction>,
    extraSystemHandlers
  );

  const requestListener = (req: IncomingMessage, res: http.ServerResponse) => {
    if (req?.url?.startsWith('/__healthcheck')) {
      res.statusCode = 200;

      return res.end();
    }

    // system API
    if (req?.url?.startsWith('/__mocks')) {
      let context = sessions.getById(SYSTEM_SESSION_ID);

      if (!context) {
        sessions.createSession({}, SYSTEM_SESSION_ID);

        context = sessions.getById(SYSTEM_SESSION_ID);
      }

      if (!context) {
        return;
      }

      context.setHandlers(allSystemHandlers as unknown as MockHandlers<MocksAPI>);

      requestHandler(context, req, res);

      return;
    }

    const sseEndpoint = sseHandlers?.find(({ path }) => {
      return req.url?.startsWith(path);
    });

    if (sseEndpoint) {
      const context = sessions.getByRequestOrDefault(req);

      if (!context) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('Session not found');

        return;
      }

      context.setHandlers(handlers);
      sseEndpoint.handler(req, res, context);

      return;
    }

    if (rewritePath && req.url) {
      // The mock is looked up by req.url, so that is what gets rewritten.
      // The query string is kept as is — handlers read it via parseRequest.
      const queryStart = req.url.indexOf('?');
      const pathname = queryStart === -1 ? req.url : req.url.slice(0, queryStart);
      const search = queryStart === -1 ? '' : req.url.slice(queryStart);
      const rewritten = rewritePath(pathname);

      if (rewritten) {
        req.url = `${rewritten}${search}`;
      }
    }

    const context = sessions.getByRequestOrDefault(req);

    if (!context) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('Session not found');

      return;
    }

    context.setHandlers(handlers);

    requestHandler(context, req, res);
  };

  const useHttp = protocol === 'http';
  const resolvedSslOptions = () => {
    return typeof sslOptions === 'function' ? sslOptions() : sslOptions;
  };
  const server = useHttp
    ? http.createServer(requestListener)
    : https.createServer(
        {
          rejectUnauthorized: false,
          ...resolvedSslOptions(),
        },
        requestListener
      );

  // Registered unconditionally so routes added later (by a plugin) still work.
  // With a listener attached Node no longer closes unhandled upgrades for us,
  // so every path that does not end in a handshake must destroy the socket —
  // otherwise the client hangs until it times out.
  const wsRoutes: MockServerOptionsWebsockets = websockets ?? [];

  server.on('upgrade', function upgrade(request, socket, head) {
    const requestUrl = request.url;

    if (!requestUrl || !wsRoutes.length) {
      socket.destroy();

      return;
    }

    let matched = wsRoutes.find((websocket) => websocket.path === requestUrl);

    // Clients connecting to a path with no registered handler fall back to
    // the first registered one when websocketFallback is enabled.
    if (!matched && websocketFallback) {
      log.debug(
        `[WS upgrade] no exact match for "${requestUrl}" — falling back to "${wsRoutes[0].path}"`
      );

      matched = wsRoutes[0];
    }

    if (!matched) {
      log.debug(`[WS upgrade] no route for "${requestUrl}" — closing`);
      socket.destroy();

      return;
    }

    const context = matched.sessionFromMessage
      ? sessions.getDefaultSession()
      : sessions.getByRequestOrDefault(request);

    if (!context) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();

      return;
    }

    context.setHandlers(handlers);

    log.debug(`[WS upgrade] requestUrl = "${requestUrl}"`);

    const wsServer = createWebSocketServer(
      context,
      request,
      matched.handler as WebSocketHandler,
      matched.sessionFromMessage,
      websocketOptions
    );

    wsServer.handleUpgrade(request, socket, head, function done(ws) {
      log.debug(`[WS handshake done] "${requestUrl}" protocol="${ws.protocol}" — 101 sent`);

      wsServer.emit('connection', ws, request);
    });
  });

  server.on('connection', (socket) => {
    log.debug(`[TCP] connection from ${socket.remoteAddress}:${socket.remotePort}`);
  });
  server.on('tlsClientError', (err: Error, socket: TLSSocket) => {
    log.debug(`[TLS error] ${err.message} (from ${socket?.remoteAddress}:${socket?.remotePort})`);
  });
  server.on('secureConnection', (tlsSocket: TLSSocket & { servername?: string }) => {
    log.debug(
      `[TLS ok] proto=${tlsSocket.getProtocol?.()} cipher=${
        tlsSocket.getCipher?.()?.name
      } servername=${tlsSocket.servername}`
    );
  });

  server.maxConnections = 2000;
  server.timeout = 120000;
  // Test runners may reuse an idle keep-alive connection for cleanup requests.
  // A longer timeout makes teardown resets less likely.
  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 65_000;

  server.listen(
    {
      host,
      port,
      // pending connections queue size
      backlog: 1000,
    },
    () => {
      log.info(
        `\n🔨 mocksmith is up: ${useHttp ? 'http' : 'https'}://${host ?? 'localhost'}:${port}\n`
      );
    }
  );

  return server;
};
