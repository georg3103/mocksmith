import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import tls from 'node:tls';

import { createSelfSignedCert } from '../test/selfSignedCert';
import { MockContext } from './context/context';
import { createRawSocketServer } from './createRawSocketServer';
import type { SocketConnection } from './socketConnection';

describe('createRawSocketServer', () => {
  const handler = (
    context: MockContext,
    _request: IncomingMessage,
    data: Buffer,
    socket: SocketConnection
  ) => {
    socket.send(data);

    return context;
  };

  test('passes binary data straight through to the raw socket handler', async () => {
    const context = new MockContext({}, 'raw-test');
    const greeting = Buffer.from('0102', 'hex');
    const payload = Buffer.from('aabbcc', 'hex');
    const rawServer = await createRawSocketServer({
      greeting,
      handler,
      host: '127.0.0.1',
      initialContext: context,
      routes: [{ path: '/core/mockfe1/', port: 0 }],
    });
    const port = (rawServer.servers[0].address() as AddressInfo).port;
    const client = net.createConnection({ host: '127.0.0.1', port });
    const received: Buffer[] = [];
    const response = new Promise<Buffer>((resolve) => {
      client.on('data', (data) => {
        received.push(data);
        const value = Buffer.concat(received);

        if (value.length >= greeting.length + payload.length) {
          resolve(value);
        }
      });
    });

    await once(client, 'connect');
    client.write(payload);

    await expect(response).resolves.toEqual(Buffer.concat([greeting, payload]));
    expect(context.getWebsocketDiagnostics().connections[0]).toMatchObject({
      path: '/core/mockfe1/',
      transport: 'raw-socket',
    });

    client.destroy();
    await rawServer.close();
  });

  test('starts a raw TLS listener with no WebSocket upstream', async () => {
    const context = new MockContext({}, 'raw-tls-test');
    const payload = Buffer.from('aabbcc', 'hex');
    const rawServer = await createRawSocketServer({
      handler,
      host: '127.0.0.1',
      initialContext: context,
      routes: [{ path: '/core/mockfe1/', port: 0, secure: true }],
      sslOptions: createSelfSignedCert(),
    });
    const port = (rawServer.servers[0].address() as AddressInfo).port;
    const client = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
    const response = new Promise<Buffer>((resolve) => client.once('data', resolve));

    await once(client, 'secureConnect');
    client.write(payload);

    await expect(response).resolves.toEqual(payload);

    client.destroy();
    await rawServer.close();
  });
});
