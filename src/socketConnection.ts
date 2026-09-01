
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
  send: (data: Buffer, callback?: (error?: Error) => void) => void;
};
