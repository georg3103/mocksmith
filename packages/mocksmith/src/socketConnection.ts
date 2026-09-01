
export const SOCKET_CONNECTING = 0;
export const SOCKET_OPEN = 1;
export const SOCKET_CLOSING = 2;
export const SOCKET_CLOSED = 3;

export type SocketTransport = 'raw-socket' | 'websocket';

/**
 * Minimal transport-agnostic contract for a bidirectional connection.
 * */
export type SocketConnection = {
  readonly readyState: number;
  close: (code?: number, reason?: string) => void;
  once: (event: 'close', listener: (code?: number, reason?: Buffer) => void) => unknown;
  /**
   * Sends a frame. A string goes out as a text frame and a Buffer as a binary
   * one — browsers care about the difference, since a binary frame arrives as
   * a Blob rather than a string.
   * */
  send: (data: Buffer | string, callback?: (error?: Error) => void) => void;
};
