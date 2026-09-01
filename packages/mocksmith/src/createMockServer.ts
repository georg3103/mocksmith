import * as http from 'http';
import * as https from 'https';
import log from 'loglevel';
import { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

import { MockContext } from './context/context';
import { sessions } from './context/session';
import { createWebSocketServer, CreateWebSocketServerOptions } from './createWebSocketServer';
import { getMockEnv } from './env';
import { requestHandler } from './proxyHandlers/requestHandler';
import { systemHandlers } from './systemHandlers';

import type { MockServerRuntimeOptions } from './config/types';
import { MockHandlers, MocksAPI, RewritePath, SseHandler, SslOptions } from './types';

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
  sseHandlers,
  sslOptions,
  rewritePath,
}: MockServerOptions<M>) => {
  const requestListener = (req: IncomingMessage, res: http.ServerResponse) => {
    if (req?.url?.startsWith('/__healthcheck')) {
      res.statusCode = 200;

      return res.end();
    }

    // system API
    if (req?.url?.startsWith('/__mocks')) {
      let context = sessions.getById('system');

      if (!context) {
        sessions.createSession({}, 'system');

        context = sessions.getById('system');
      }

      if (!context) {
        return;
      }

      context.setHandlers(systemHandlers as unknown as MockHandlers<MocksAPI>);

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

  if (websockets?.length) {
    server.on('upgrade', function upgrade(request, socket, head) {
      const requestUrl = request.url;

      if (!requestUrl) {
        return;
      }

      let matched = websockets.find((websocket) => websocket.path === requestUrl);

      // Clients connecting to a path with no registered handler fall back to
      // the first registered one when websocketFallback is enabled.
      if (!matched && websocketFallback && websockets.length) {
        log.debug(
          `[WS upgrade] no exact match for "${requestUrl}" — falling back to "${websockets[0].path}"`
        );

        matched = websockets[0];
      }

      const context = matched?.sessionFromMessage
        ? sessions.getDefaultSession()
        : sessions.getByRequestOrDefault(request);

      if (!context) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();

        return;
      }

      context.setHandlers(handlers);

      log.debug(`[WS upgrade] requestUrl = "${requestUrl}"`);

      if (matched) {
        const wsServer = createWebSocketServer(
          context,
          request,
          matched.handler as WebSocketHandler,
          matched.sessionFromMessage,
          websocketOptions
        );

        wsServer.handleUpgrade(request, socket, head, function done(ws) {
          log.debug(
            `[WS handshake done] "${requestUrl}" protocol="${ws.protocol}" — 101 sent`
          );

          wsServer.emit('connection', ws, request);
        });
      }

      return websockets;
    });
  }

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
