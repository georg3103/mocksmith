/**
 * Encoding of messages pushed into open websockets via the system API
 * (`/__mocks/api/sendToWebsocket`).
 *
 * The default encoder emits JSON. Projects speaking a custom (e.g. binary)
 * protocol register their own encoder via `setWebsocketMessageEncoder` or the
 * `websocket.encodeMessage` config option.
 * */

export type WebsocketOutgoingMessage = {
  data: unknown | unknown[];
  type?: string;
};

export type WebsocketMessageEncoder = (
  messages: WebsocketOutgoingMessage[]
) => Buffer | string | Promise<Buffer | string>;

const defaultEncoder: WebsocketMessageEncoder = (messages) => {
  const payloads = messages.flatMap((message) =>
    Array.isArray(message.data) ? message.data : [message.data]
  );

  return Buffer.from(JSON.stringify(payloads.length === 1 ? payloads[0] : payloads));
};

let encoder: WebsocketMessageEncoder = defaultEncoder;

export const setWebsocketMessageEncoder = (custom?: WebsocketMessageEncoder) => {
  encoder = custom ?? defaultEncoder;
};

export const encodeWebsocketMessages = async (
  data: WebsocketOutgoingMessage | WebsocketOutgoingMessage[]
): Promise<Buffer> => {
  const messages = Array.isArray(data) ? data : [data];
  const encoded = await encoder(messages);

  return Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
};
