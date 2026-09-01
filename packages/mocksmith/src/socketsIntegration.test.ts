import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { WebSocket } from 'ws';

import { createSelfSignedCert } from '../test/selfSignedCert';
import { startMockerFromConfig } from './config/startMockerFromConfig';
import { sessions } from './context/session';

import type { Server } from 'node:http';
import type { ResolvedMockerConfig } from './config/types';
import type { MockContext } from './context/context';
import type { SocketConnection } from './socketConnection';

/**
 * Exercises the socket transports the way a project actually configures them:
 * through a config and startMockerFromConfig, rather than by calling the
 * server factories directly. The unit tests cover the factories; this covers
 * the path from config to a real TCP client.
 * */
const HTTP_PORT = 45_401;
const PLAIN_PORT = 45_402;
const TLS_PORT = 45_403;

let certificateDirectory: string;

const rawHandler = (
  context: MockContext,
  _request: unknown,
  data: Buffer,
  socket: SocketConnection
) => {
  socket.send(Buffer.concat([Buffer.from('echo:'), data]));

  return context;
};

const websocketEcho = (
  context: MockContext,
  _request: unknown,
  data: unknown,
  ws: { send: (payload: string) => void }
) => {
  ws.send(JSON.stringify({ type: 'echo', payload: String(data) }));

  return context;
};

const buildConfig = (): ResolvedMockerConfig => ({
  config: {
    server: { host: '127.0.0.1', port: HTTP_PORT, rawSockets: true },
    handlers: [{ '/api/ping': { response: { body: { ok: true } } } }],
    defaultSessionData: {},
    websocketHandlers: [{ path: '/ws/main', handler: websocketEcho }],
    websocket: { echoSubprotocols: ['my-client.native'] },
    ssl: { key: path.join(certificateDirectory, 'key.pem'), cert: path.join(certificateDirectory, 'cert.pem') },
    rawSockets: {
      handler: rawHandler,
      greetingHex: '0102',
      routes: [
        { path: '/feed/plain', port: PLAIN_PORT },
        { path: '/feed/secure', port: TLS_PORT, secure: true },
      ],
    },
  } as unknown as ResolvedMockerConfig['config'],
  configDirectory: certificateDirectory,
  configPath: path.join(certificateDirectory, 'mocksmith.config.ts'),
  serverUrl: `http://127.0.0.1:${HTTP_PORT}`,
});

/** Reads from a socket until it has at least `expected` bytes. */
const readBytes = (socket: net.Socket, expected: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error('timed out reading from the socket')), 4000);

    socket.on('data', (chunk) => {
      chunks.push(chunk);

      const all = Buffer.concat(chunks);

      if (all.length >= expected) {
        clearTimeout(timer);
        resolve(all);
      }
    });
    socket.on('error', reject);
  });

let server: Server;

beforeAll(async () => {
  certificateDirectory = mkdtempSync(path.join(os.tmpdir(), 'mocksmith-sockets-'));

  const { cert, key } = createSelfSignedCert();

  writeFileSync(path.join(certificateDirectory, 'cert.pem'), cert);
  writeFileSync(path.join(certificateDirectory, 'key.pem'), key);

  server = (await startMockerFromConfig(buildConfig(), { rawSockets: true })) as Server;

  if (!server.listening) {
    await once(server, 'listening');
  }
});

afterAll(async () => {
  server.close();
  await once(server, 'close');

  for (const id of sessions.listIds()) {
    sessions.clearSession(id);
  }

  sessions.setDefaultSessionId();
  rmSync(certificateDirectory, { recursive: true, force: true });
});

describe('raw sockets, configured the way a project would', () => {
  test('a plain TCP client gets the greeting and reaches the handler', async () => {
    const client = net.createConnection({ host: '127.0.0.1', port: PLAIN_PORT });
    const greeting = readBytes(client, 2);

    await once(client, 'connect');
    expect((await greeting).subarray(0, 2).toString('hex')).toBe('0102');

    const echoed = readBytes(client, 'echo:hello'.length);

    client.write('hello');
    expect((await echoed).toString()).toBe('echo:hello');

    client.destroy();
  });

  test('a TLS client completes the handshake and reaches the same handler', async () => {
    const client = tls.connect({ host: '127.0.0.1', port: TLS_PORT, rejectUnauthorized: false });
    const greeting = readBytes(client, 2);

    await once(client, 'secureConnect');
    expect((await greeting).subarray(0, 2).toString('hex')).toBe('0102');

    const echoed = readBytes(client, 'echo:secure'.length);

    client.write('secure');
    expect((await echoed).toString()).toBe('echo:secure');

    client.destroy();
  });

  test('HTTP keeps working on the same server', async () => {
    const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/ping`);

    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('websockets, configured the way a project would', () => {
  const openSocket = (path: string, protocols?: string[]) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}${path}`, protocols);

      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });

  test('echoes back a subprotocol the client insists on', async () => {
    // Native clients can require their subprotocol in the 101 response and drop
    // the connection otherwise.
    const socket = await openSocket('/ws/main', ['my-client.native']);

    expect(socket.protocol).toBe('my-client.native');
    socket.close();
  });

  test('the handler answers, and the system API can push and close', async () => {
    const socket = await openSocket('/ws/main');
    const api = async (endpoint: string, body: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/__mocks/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      return response.json();
    };

    const reply = new Promise<string>((r) => socket.once('message', (d) => r(String(d))));

    socket.send('ping');
    expect(JSON.parse(await reply)).toEqual({ type: 'echo', payload: 'ping' });

    const state = (await api('websockets/state', { id: 'default' })) as {
      connections: Array<{ path: string }>;
    };

    expect(state.connections.map(({ path }) => path)).toContain('/ws/main');

    const pushed = new Promise<string>((r) => socket.once('message', (d) => r(String(d))));

    await api('sendToWebsocket', { id: 'default', data: { data: { type: 'pushed' } } });
    expect(JSON.parse(await pushed)).toEqual({ type: 'pushed' });

    const closed = new Promise<number>((r) => socket.once('close', (code) => r(code)));
    const result = (await api('websockets/close', { id: 'default', code: 4001 })) as {
      closed: number;
    };

    expect(result.closed).toBeGreaterThan(0);
    expect(await closed).toBe(4001);
  });

  test('an unregistered path is refused rather than left hanging', async () => {
    await expect(openSocket('/ws/nope')).rejects.toThrow();
  });
});
