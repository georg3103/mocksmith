import { useCallback, useEffect, useRef, useState } from 'react';

import type { Member, Message, Room } from '../types';
import type { Roster } from './api';

export type Channel = 'http' | 'sse' | 'ws';

export type LogEntry = { at: string; channel: Channel; id: number; text: string };

export type TransportState = 'down' | 'live' | 'waiting';

export type Frame =
  | { type: 'echo'; payload: string }
  | { type: 'message-updated'; message: Message }
  | { type: 'message'; message: Message }
  | { type: 'pong'; at: string }
  | { type: 'rooms'; rooms: Room[] }
  | { type: 'typing'; typing: string[] }
  | { type: 'welcome'; at: string; members: Member[] };

const LOG_LENGTH = 16;

let entryId = 0;

/**
 * One line per thing that actually crossed the wire. Chrome's Network panel
 * only records a websocket while it is open, and SSE events hide inside the
 * EventStream tab of a single request — so the page keeps its own log and all
 * three transports are visible without opening the inspector at all.
 * */
export const useEventLog = () => {
  const [events, setEvents] = useState<LogEntry[]>([]);

  const logEvent = useCallback((channel: Channel, text: string) => {
    entryId += 1;

    const entry: LogEntry = { id: entryId, at: new Date().toLocaleTimeString(), channel, text };

    setEvents((current) => [entry, ...current].slice(0, LOG_LENGTH));
  }, []);

  return { events, logEvent };
};

type WireOptions = {
  logEvent: (channel: Channel, text: string) => void;
  /** Called for every websocket frame that carries chat data. */
  onFrame: (frame: Frame) => void;
  /** The socket came back after a break: the world may have moved on. */
  onReconnect: () => void;
};

/**
 * The websocket and the SSE stream, with the failure handling each one needs.
 * */
export const useWire = ({ logEvent, onFrame, onReconnect }: WireOptions) => {
  const [socketState, setSocketState] = useState<TransportState>('waiting');
  const [socketNote, setSocketNote] = useState('connecting…');
  const [streamState, setStreamState] = useState<TransportState>('waiting');
  const [streamNote, setStreamNote] = useState('connecting…');
  const [roster, setRoster] = useState<Roster | undefined>();
  const socketRef = useRef<WebSocket>();

  // The effect must not restart when a callback identity changes, so the
  // callbacks are read through a ref instead of being dependencies.
  const handlers = useRef({ logEvent, onFrame, onReconnect });

  handlers.current = { logEvent, onFrame, onReconnect };

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    /**
     * The websocket carries the room: messages posted anywhere in this session
     * arrive here, including the ones this tab posted itself.
     *
     * A websocket does not reconnect by itself (an EventSource does), so this
     * reopens it with a backoff. Restart the mock server and the page finds it
     * again instead of sitting there dead.
     * */
    const connect = () => {
      socket = new WebSocket(`ws://${location.host}/ws`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        socket?.send(JSON.stringify({ type: 'hello' }));
        socket?.send(JSON.stringify({ type: 'ping' }));
        handlers.current.logEvent('ws', attempt > 0 ? '↑ hello (reconnected)' : '↑ hello');

        if (attempt > 0) {
          handlers.current.onReconnect();
        }

        attempt = 0;
      });

      socket.addEventListener('error', () => socket?.close());
      socket.addEventListener('close', () => {
        if (disposed) {
          return;
        }

        attempt += 1;

        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);

        setSocketState('waiting');
        setSocketNote('reconnecting…');
        handlers.current.logEvent('ws', `connection lost · retrying in ${backoff / 1000}s`);
        retryTimer = setTimeout(connect, backoff);
      });

      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as Frame;

        setSocketState('live');

        if (frame.type === 'pong') {
          setSocketNote(`pong ${new Date(frame.at).toLocaleTimeString()}`);
          handlers.current.logEvent('ws', '↓ pong');

          return;
        }

        if (frame.type === 'welcome') {
          setSocketNote(`${frame.members.length} members`);
        }

        if (frame.type === 'message') {
          handlers.current.logEvent('ws', `↓ message · "${frame.message.text.slice(0, 28)}"`);
        }

        if (frame.type === 'typing') {
          handlers.current.logEvent(
            'ws',
            frame.typing.length ? `↓ typing · ${frame.typing.join(', ')}` : '↓ typing stopped'
          );
        }

        handlers.current.onFrame(frame);
      });
    };

    connect();

    let stream: EventSource | undefined;
    let lastBeat = Date.now();
    let beats = 0;
    let lastSummary = '';

    // An EventSource reconnects on its own; `readyState` says whether this
    // error is a retry in progress or the end of the stream.
    const openStream = () => {
      stream = new EventSource('/sse/presence');

      stream.addEventListener('error', () => {
        const retrying = stream?.readyState === EventSource.CONNECTING;

        setStreamState(retrying ? 'waiting' : 'down');
        setStreamNote(retrying ? 'reconnecting…' : 'closed');
        handlers.current.logEvent('sse', retrying ? 'stream error · reconnecting' : 'stream closed');
      });
      stream.addEventListener('message', (event) => {
        const next = JSON.parse(String(event.data)) as Roster;
        const online = next.members.filter((member) => member.status === 'online').length;
        const summary = `${online} online${next.typing.length ? ` · ${next.typing.join(', ')} typing` : ''}`;

        lastBeat = Date.now();
        beats += 1;
        setRoster(next);
        setStreamState('live');
        setStreamNote(`${summary} · beat ${beats}`);

        // Every beat in the log would drown everything else, so only changes
        // are recorded — the beat counter above is the liveness indicator.
        if (summary !== lastSummary) {
          handlers.current.logEvent('sse', beats === 1 ? `roster open · ${summary}` : `↓ ${summary}`);
          lastSummary = summary;
        }
      });
    };

    openStream();

    /**
     * The stream beats once a second, and that heartbeat is what makes a stall
     * detectable. When the mock server dies behind the dev server's proxy, the
     * browser is not told: the connection stays open and simply goes quiet, so
     * an `error` event never arrives. Silence is the only signal — treat it as
     * one and reopen, instead of showing a green light over a dead stream.
     * */
    const watchdog = setInterval(() => {
      if (Date.now() - lastBeat < 5000) {
        return;
      }

      lastBeat = Date.now();
      setStreamState('waiting');
      setStreamNote('stalled — reopening…');
      handlers.current.logEvent('sse', 'no beat for 5s · reopening the stream');
      stream?.close();
      openStream();
    }, 2000);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);

      // Closing a socket mid-handshake throws it away before the connection is
      // established, so wait for it to open first.
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close();
      } else {
        socket?.addEventListener('open', () => socket?.close());
      }

      stream?.close();
    };
  }, []);

  /** Tells the server this tab is typing; other tabs of the session hear it. */
  const notifyTyping = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'typing' }));
    }
  }, []);

  return { notifyTyping, roster, socketNote, socketState, streamNote, streamState };
};
