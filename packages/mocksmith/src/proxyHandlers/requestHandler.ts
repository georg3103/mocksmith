import { extractBodyFromString } from '../utils/extractBodyFromString';
import { parseRequest } from '../utils/parseIncomingRequest';
import { encodeWebsocketMessages } from '../websocketEncoder';

import { MockData, ReqFunction } from '../types';

/**
 * Lets an HTTP mock push a message into the websockets of the same session:
 * a request triggers a server-side event. Encoding goes through the
 * configured encoder, so custom protocols work here too.
 * */
const createWebSocketSender =
  (context: Parameters<ReqFunction>[0]) =>
  (data: unknown, delay?: number): boolean => {
    const sockets = context.getWebsockets();

    if (!sockets.length) {
      return false;
    }

    const send = async () => {
      const payload = await encodeWebsocketMessages({ data });

      sockets.forEach((socket) => socket.send(payload));
    };

    if (delay) {
      const timer = setTimeout(() => void send(), delay);

      timer.unref();
    } else {
      void send();
    }

    return true;
  };

export const requestHandler: ReqFunction = async (context, req, res) => {
  try {
    const parsedData = await parseRequest(req);

    // Endpoint response override (CLI `endpoint set` / scenario)
    const override = context.getOverride(parsedData.path, parsedData.query);

    if (override) {
      if (override.abort) {
        res.destroy(); // dropped connection — the client sees a network error

        return;
      }

      if (override.delay) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, override.delay);

          timer.unref();
        });
      }

      const overrideHeaders = {
        'content-type': 'application/json; charset=utf-8;',
        ...override.headers,
      };

      for (const [key, value] of Object.entries(overrideHeaders)) {
        res.setHeader(key, value);
      }

      res.writeHead(override.status ?? 200);
      res.end(
        extractBodyFromString(override.body as MockData['response']['body'], overrideHeaders)
      );

      return;
    }

    const mock = await context.processMock({
      sendToWebSocket: createWebSocketSender(context),
      name: parsedData.path,
      request: req,
      data: parsedData,
    });

    if (!mock || !(mock as MockData).response) {
      throw Error('Mock not found');
    }

    const mockResponse = (mock as MockData).response;

    const resHeaders = {
      'content-type': 'application/json; charset=utf-8;',
      ...mockResponse.headers,
    };

    if (resHeaders) {
      for (const [key, value] of Object.entries(resHeaders)) {
        if (typeof value !== 'undefined') {
          res.setHeader(key, value as string);
        }
      }
    }

    res.writeHead(mockResponse.status ?? 200);

    const body = extractBodyFromString(mockResponse.body, resHeaders);

    res.end(body);

    return;
  } catch (error: unknown) {
    res.setHeader('content-type', 'text/plain');
    res.writeHead(404);

    res.end(error?.toString());
  }
};
