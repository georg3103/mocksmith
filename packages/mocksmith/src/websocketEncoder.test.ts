import {
  encodeWebsocketMessages,
  setWebsocketMessageEncoder,
  type WebsocketMessageEncoder,
} from './websocketEncoder';

afterEach(() => {
  setWebsocketMessageEncoder();
});

/**
 * The frame type is not cosmetic: `ws` sends a Buffer as a binary frame, which
 * reaches a browser as a Blob, so `JSON.parse(event.data)` throws. Node clients
 * paper over it — `String(buffer)` reads back fine — so this only ever showed
 * up in a real page, which is why it is pinned here.
 * */
describe('websocket message encoding', () => {
  test('JSON goes out as a text frame, not a Buffer', async () => {
    const encoded = await encodeWebsocketMessages({ data: { type: 'notification' } });

    expect(typeof encoded).toBe('string');
    expect(JSON.parse(encoded as string)).toEqual({ type: 'notification' });
  });

  test('a single message is not wrapped in an array', async () => {
    const encoded = await encodeWebsocketMessages({ data: { id: 1 } });

    expect(JSON.parse(encoded as string)).toEqual({ id: 1 });
  });

  test('several messages arrive as an array', async () => {
    const encoded = await encodeWebsocketMessages([{ data: { id: 1 } }, { data: { id: 2 } }]);

    expect(JSON.parse(encoded as string)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('a custom encoder may still return a Buffer for binary protocols', async () => {
    const binary: WebsocketMessageEncoder = () => Buffer.from([0x01, 0x02]);

    setWebsocketMessageEncoder(binary);

    const encoded = await encodeWebsocketMessages({ data: {} });

    expect(Buffer.isBuffer(encoded)).toBe(true);
    expect(encoded).toEqual(Buffer.from([0x01, 0x02]));
  });

  test('resetting restores the JSON encoder', async () => {
    setWebsocketMessageEncoder(() => Buffer.from('custom'));
    setWebsocketMessageEncoder();

    expect(typeof (await encodeWebsocketMessages({ data: { ok: true } }))).toBe('string');
  });
});
