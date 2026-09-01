import log from 'loglevel';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import net, { type Server as NetServer, type Socket } from 'node:net';
import tls, { type SecureContextOptions } from 'node:tls';

import { MockContext } from './context/context';
import { sessions } from './context/session';
import {
  SOCKET_CLOSED,
  SOCKET_CLOSING,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  type SocketConnection,
} from './socketConnection';

import type { MockerRawSocketHandler, MockerRawSocketRoute } from './config/types';

type CreateRawSocketServerOptions = {
  greeting?: Buffer;
  handler: MockerRawSocketHandler;
  host?: string;
  initialContext: MockContext;
  routes: MockerRawSocketRoute[];
  sslOptions?: SecureContextOptions;
};

type RawSocketServer = {
  close: () => Promise<void>;
  servers: NetServer[];
};

class RawSocketConnection extends EventEmitter implements SocketConnection {
  public constructor(private readonly socket: Socket) {
    super();
    socket.once('close', () => this.emit('close'));
  }

  public get readyState() {
    if (this.socket.destroyed) {
      return SOCKET_CLOSED;
    }

    if (this.socket.connecting) {
      return SOCKET_CONNECTING;
    }

    if (!this.socket.writable) {
      return SOCKET_CLOSING;
    }

    return SOCKET_OPEN;
  }

  public send(data: Buffer, callback?: (error?: Error) => void) {
    if (this.readyState !== SOCKET_OPEN) {
      callback?.(new Error('Raw socket is already closed'));

      return;
    }

    try {
      this.socket.write(data, () => callback?.());
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public close() {
    this.socket.end();
  }

  public override once(event: 'close', listener: (code?: number, reason?: Buffer) => void): this {
    return super.once(event, listener);
  }
}

const listen = (server: NetServer, host: string | undefined, port: number) => {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, () => {
      server.off('error', reject);
      resolve();
    });
  });
};

const close = (server: NetServer) => {
  return new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();

      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
};

export const createRawSocketServer = async ({
  greeting,
  handler,
  host,
  initialContext,
  routes,
  sslOptions,
}: CreateRawSocketServerOptions): Promise<RawSocketServer> => {
  const servers: NetServer[] = [];
  const sockets = new Set<Socket>();

  const connect = (route: MockerRawSocketRoute, socket: Socket) => {
    const connection = new RawSocketConnection(socket);
    const request = { headers: {}, url: route.path } as IncomingMessage;
    let context = initialContext;
    let isRegistered = false;
    let processing = Promise.resolve<unknown>(undefined);

    sockets.add(socket);

    log.debug(
      `[raw-socket] :${route.port} connection from ${socket.remoteAddress}:${socket.remotePort} -> ${route.path}`
    );

    if (greeting?.length) {
      socket.write(greeting);
    }

    const checkSessionInterval = setInterval(() => {
      if (isRegistered && !sessions.getById(context.id)) {
        log.debug('[raw-socket] session gone, closing the connection');
        connection.close();
      }
    }, 1000);

    socket.on('data', (data) => {
      processing = processing
        .then(() => handler(context, request, data, connection))
        .then((resolvedContext) => {
          if (!(resolvedContext instanceof MockContext)) {
            return;
          }

          context = resolvedContext;

          if (!isRegistered) {
            context.registerSocket(route.path, connection, 'raw-socket');
            isRegistered = true;
          }
        })
        .catch((error) => {
          log.error(`[raw-socket] :${route.port} message handler failed:`, error);
          connection.close();
        });
    });
    socket.on('close', () => {
      clearInterval(checkSessionInterval);
      sockets.delete(socket);
    });
    socket.on('error', (error) => {
      log.warn(`[raw-socket] :${route.port} client error: ${error.message}`);
    });
  };

  try {
    for (const route of routes) {
      if (route.secure && !sslOptions) {
        throw new Error(`The raw socket on port ${route.port} requires ssl in the config`);
      }

      const server = route.secure
        ? tls.createServer(sslOptions as SecureContextOptions, (socket) => connect(route, socket))
        : net.createServer((socket) => connect(route, socket));

      server.on('error', (error) => {
        log.error(`[raw-socket] :${route.port} server error: ${error.message}`);
      });

      await listen(server, host, route.port);
      servers.push(server);
      log.info(
        `[raw-socket] ${route.secure ? 'TLS' : 'plain TCP'} :${route.port} -> ${route.path}`
      );
    }
  } catch (error) {
    await Promise.allSettled(servers.map(close));

    throw error;
  }

  return {
    servers,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await Promise.all(servers.map(close));
    },
  };
};
