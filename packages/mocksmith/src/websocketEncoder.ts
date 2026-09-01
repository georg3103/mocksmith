/**
 * Encoding of messages pushed into open websockets via the system API
 * (`/__mocks/api/sendToWebsocket`) or from an HTTP handler.
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

/**
 * Returns a string, which `ws` sends as a text frame.
 *
 * This matters to browsers: a Buffer goes out as a binary frame and arrives as
 * a Blob, so `JSON.parse(event.data)` fails. Node clients hide the difference —
 * `String(buffer)` reads fine — so the frame type only shows up in a real page.
 * */
const defaultEncoder: WebsocketMessageEncoder = (messages) => {
  const payloads = messages.flatMap((message) =>
    Array.isArray(message.data) ? message.data : [message.data]
  );

  return JSON.stringify(payloads.length === 1 ? payloads[0] : payloads);
};

let encoder: WebsocketMessageEncoder = defaultEncoder;

export const setWebsocketMessageEncoder = (custom?: WebsocketMessageEncoder) => {
  encoder = custom ?? defaultEncoder;
};

/**
 * Encodes messages for the wire, preserving what the encoder returned: a string
 * stays a text frame, a Buffer stays binary.
 * */
export const encodeWebsocketMessages = async (
  data: WebsocketOutgoingMessage | WebsocketOutgoingMessage[]
): Promise<Buffer | string> => {
  const messages = Array.isArray(data) ? data : [data];

  return encoder(messages);
};
