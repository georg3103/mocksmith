import log from 'loglevel';
import { IncomingMessage } from 'node:http';
import WebSocket, { RawData, WebSocketServer } from 'ws';

import { MockContext } from './context/context';
import { sessions } from './context/session';

type WebSocketHandler = (
  context: MockContext,
  request: IncomingMessage,
  data: RawData,
  ws: WebSocket
) => unknown;

export type CreateWebSocketServerOptions = {
  /**
   * Subprotocols the server echoes back in the 101 response when the client
   * requests one of them. Some native clients require their subprotocol to be
   * accepted and drop the connection otherwise. Any other requested
   * subprotocol is echoed as is (first one wins).
   * */
  echoSubprotocols?: string[];
};

export const createWebSocketServer = (
  initialContext: MockContext,
  request: IncomingMessage,
  handler: WebSocketHandler,
  sessionFromMessage = false,
  options: CreateWebSocketServerOptions = {}
) => {
  const wsServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // compression off, favors throughput
    maxPayload: 1024 * 1024, // 1MB max message size
    clientTracking: false,
    // Web clients typically send no subprotocol — this callback is not called
    // for them at all.
    handleProtocols: (protocols: Set<string>) => {
      const preferred = options.echoSubprotocols?.find((protocol) => protocols.has(protocol));

      if (preferred) {
        return preferred;
      }

      const [first] = protocols;

      return first ?? false;
    },
  });

  wsServer.on('connection', (ws) => {
    let context = initialContext;
    let isRegistered = false;
    let isServerClosed = false;

    const register = () => {
      if (isRegistered) {
        return;
      }

      context.setWebscoket(request.url ?? '', ws);
      context.registerWebsocket(request.url ?? '', ws);
      isRegistered = true;
    };

    const closeServer = () => {
      if (isServerClosed) {
        return;
      }

      isServerClosed = true;
      wsServer.close();
    };
    const requestUrl = request.url;

    if (!requestUrl) {
      ws.close(1008);
      closeServer();

      return;
    }

    if (!sessionFromMessage) {
      register();
    }

    // Close the connection as soon as its session disappears
    const checkSessionInterval = setInterval(() => {
      if (isRegistered && !sessions.getById(context.id)) {
        log.debug('session gone, closing the connection');
        clearInterval(checkSessionInterval);
        ws.close(1001);
        closeServer();
      }
    }, 1000);

    ws.binaryType = 'arraybuffer';

    ws.on('message', (data) => {
      void Promise.resolve(handler(context, request, data, ws))
        .then((resolvedContext) => {
          if (resolvedContext instanceof MockContext) {
            context = resolvedContext;
            register();
          }
        })
        .catch((error) => {
          log.error('WS: message handler failed:', error);

          if (sessionFromMessage) {
            ws.close(1008, 'session not found');
          }
        });
    });

    ws.on('close', () => {
      clearInterval(checkSessionInterval);
      closeServer();
    });

    ws.on('error', (error) => {
      log.error('WS: error:', error);
    });

    wsServer.on('close', () => {
      clearInterval(checkSessionInterval);
    });
  });

  return wsServer;
};
