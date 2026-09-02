import { useCallback, useEffect, useRef, useState } from 'react';

import { api, mockUri, rawPort, system, type Me, type RoomSummary } from './api';
import { ScenarioMenu } from './ScenarioMenu';
import { useEventLog, useWire, type Frame } from './useWire';

import type { FormEvent } from 'react';
import type { Message } from '../types';

/** A message this tab is trying to send, until the server confirms it. */
type Outgoing = { error?: string; id: string; text: string };

const REACTIONS = ['👍', '🔥'];

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const appUri = typeof location === 'undefined' ? '' : location.origin;

export const App = () => {
  const { events, logEvent } = useEventLog();

  const [me, setMe] = useState<Me>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomId, setRoomId] = useState('general');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [roomError, setRoomError] = useState<string>();
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [draft, setDraft] = useState('');
  const [lastCall, setLastCall] = useState('—');
  const [typing, setTyping] = useState<string[]>([]);

  const roomRef = useRef(roomId);
  const threadRef = useRef<HTMLDivElement>(null);

  roomRef.current = roomId;

  const newest = messages[messages.length - 1]?.id;

  // Chat convention: whatever arrives — from here, another tab, the CLI or the
  // TCP client — the thread ends up showing it.
  useEffect(() => {
    // Two frames: the first lets the bubbles lay out, the second catches the
    // height the layout settled on, so the newest message is fully in view.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const thread = threadRef.current;

        if (thread) {
          thread.scrollTop = thread.scrollHeight;
        }
      });
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [newest, outgoing.length]);

  const call = useCallback(
    async <T,>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await run();

        setLastCall(`${label} · 200`);
        logEvent('http', `${label} · 200`);

        return result;
      } catch (error) {
        const message = (error as Error).message;

        setLastCall(`${label} · ${message}`);
        logEvent('http', `${label} · ${message}`);

        return undefined;
      }
    },
    [logEvent]
  );

  const loadRooms = useCallback(async () => {
    const result = await call('GET /api/rooms', api.rooms);

    if (result) {
      setRooms(result.rooms);
    }
  }, [call]);

  const openRoom = useCallback(
    async (nextRoom: string) => {
      setRoomId(nextRoom);
      setHistoryError(undefined);
      setRoomError(undefined);

      const page = await call(`GET /api/rooms/${nextRoom}/messages`, () => api.history(nextRoom));

      if (!page) {
        setRoomError('The room did not load.');
        setMessages([]);

        return;
      }

      setMessages(page.messages);
      setHasMore(page.hasMore);

      await call(`POST /api/rooms/${nextRoom}/read`, () => api.read(nextRoom));
      await loadRooms();
    },
    [call, loadRooms]
  );

  const loadOlder = async () => {
    const oldest = messages[0]?.id;
    const page = await call(`GET /api/rooms/${roomId}/messages?before=${oldest}`, () =>
      api.history(roomId, oldest)
    );

    if (!page) {
      setHistoryError('Older messages are unavailable.');

      return;
    }

    setHistoryError(undefined);
    setMessages((current) => [...page.messages, ...current]);
    setHasMore(page.hasMore);
  };

  const reload = useCallback(async () => {
    const identity = await call('GET /api/me', api.me);

    if (identity) {
      setMe(identity);
    }

    await openRoom(roomRef.current);
  }, [call, openRoom]);

  useEffect(() => {
    void reload();
    // Once, on mount: everything after this arrives over a socket or a click.
  }, []);

  /**
   * Frames land here whoever caused them — this tab, another tab, the CLI, the
   * `bot say` plugin or the TCP client. A message is added by id, so the copy
   * that comes back over the socket after a send is not a duplicate.
   * */
  const onFrame = useCallback((frame: Frame) => {
    if (frame.type === 'message' || frame.type === 'message-updated') {
      const { message } = frame;

      if (message.roomId !== roomRef.current) {
        return;
      }

      setMessages((current) => {
        const index = current.findIndex((item) => item.id === message.id);

        if (index === -1) {
          return [...current, message];
        }

        const next = [...current];

        next[index] = message;

        return next;
      });
    }

    if (frame.type === 'typing') {
      setTyping(frame.typing);
    }

    if (frame.type === 'rooms') {
      setRooms((current) =>
        current.map((room) => ({ ...room, ...frame.rooms.find((item) => item.id === room.id) }))
      );
    }
  }, []);

  const { notifyTyping, roster, socketNote, socketState, streamNote, streamState } = useWire({
    logEvent,
    onFrame,
    onReconnect: () => void reload(),
  });

  const send = async (text: string, key: string) => {
    const result = await call(`POST /api/rooms/${roomId}/outbox`, () => api.send(roomId, text));

    if (!result) {
      setOutgoing((current) =>
        current.map((item) => (item.id === key ? { ...item, error: 'not sent' } : item))
      );

      return;
    }

    setOutgoing((current) => current.filter((item) => item.id !== key));
    setMessages((current) =>
      current.some((item) => item.id === result.message.id) ? current : [...current, result.message]
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const text = draft.trim();

    if (!text) {
      return;
    }

    const key = `out-${Date.now()}`;

    setDraft('');
    setOutgoing((current) => [...current, { id: key, text }]);
    void send(text, key);
  };

  const react = async (message: Message, emoji: string) => {
    const result = await call(`POST /api/messages/${message.id}/reactions`, () =>
      api.react(message.id, emoji)
    );

    if (result) {
      onFrame({ type: 'message-updated', message: result.message });
    }
  };

  /**
   * The room talking back is a fact about the world, so the switch writes to
   * the world: `patchSession`, the same route the CLI's `session set` uses.
   * The chatter plugin picks the change up on its next tick.
   * */
  const toggleChatter = async () => {
    if (!me) {
      return;
    }

    const on = !me.chatter.on;

    await system('patchSession', { id: me.sessionId, patch: { chatter: { on } } });
    setMe({ ...me, chatter: { ...me.chatter, on } });
    logEvent('http', `chatter ${on ? 'on' : 'off'}`);
  };

  /**
   * Simulates the connection dropping, through the same system route a test
   * uses. The code has to be one a client is allowed to send: 1006 is reserved
   * for "the connection died on its own" and `close()` refuses it.
   * */
  const dropSocket = async () => {
    if (!me) {
      return;
    }

    try {
      await system('websockets/close', { id: me.sessionId, code: 4000, reason: 'demo' });
      logEvent('ws', 'asked the server to drop the socket');
    } catch (error) {
      logEvent('ws', `drop failed · ${(error as Error).message}`);
    }
  };

  const nameOf = useCallback(
    (authorId: string) => roster?.members.find((member) => member.id === authorId)?.name ?? authorId,
    [roster]
  );

  const room = rooms.find((item) => item.id === roomId);
  const reactionsOn = Boolean(me?.flags.REACTIONS);
  // The server keeps the notice away from the tab that caused it, so whatever
  // arrives here is always somebody else at the keyboard.
  const others = typing;

  return (
    <div className="page">
      <aside className="rail">
        <header className="rail__head">
          <p className="eyebrow">mocksmith example</p>
          <h1>Forge Chat</h1>
        </header>

        {me && (
          <p className="who">
            <span data-testid="me-name">{me.me.name}</span>
            <span className={`plan plan--${me.me.plan}`} data-testid="me-plan">
              {me.me.plan}
            </span>
          </p>
        )}

        <nav className="rooms" aria-label="Rooms">
          {rooms.map((item) => (
            <button
              className={item.id === roomId ? 'room room--on' : 'room'}
              data-testid="room"
              key={item.id}
              onClick={() => void openRoom(item.id)}
              type="button"
            >
              <span className="room__title">#{item.title}</span>
              {item.unread > 0 && (
                <span className="badge" data-testid="room-unread">
                  {item.unread}
                </span>
              )}
              <span className="room__preview">{item.preview}</span>
            </button>
          ))}
        </nav>

        <section className="roster" aria-label="Members">
          <h2>In the shop</h2>
          <ul data-testid="roster">
            {(roster?.members ?? []).map((member) => (
              <li data-testid="member" key={member.id}>
                <span className={`dot dot--${member.status}`} />
                <span data-testid="member-name">{member.name}</span>
                <span className="mono status">{member.status}</span>
              </li>
            ))}
          </ul>
        </section>

        {me && (
          <section className="roster" aria-label="Feature flags">
            <h2>Flags</h2>
            <ul data-testid="flags">
              {Object.entries(me.flags).map(([name, on]) => (
                <li data-testid="flag" key={name}>
                  <span className={`dot dot--${on ? 'online' : 'offline'}`} />
                  <span className="mono">{name}</span>
                  <span className="mono status">{on ? 'on' : 'off'}</span>
                </li>
              ))}
              <li>
                <span className={`dot dot--${me.chatter.on ? 'online' : 'offline'}`} />
                <span className="mono">LIVE TRAFFIC</span>
                <button
                  className="button button--ghost status"
                  data-testid="chatter-toggle"
                  onClick={() => void toggleChatter()}
                  type="button"
                >
                  {me.chatter.on ? 'turn off' : 'turn on'}
                </button>
              </li>
            </ul>
          </section>
        )}

        {me && (
          <ScenarioMenu
            onApplied={() => void reload()}
            onLog={(text) => logEvent('http', text)}
            sessionId={me.sessionId}
          />
        )}
      </aside>

      <main className="chat">
        <header className="chat__head">
          <div>
            <h2 data-testid="room-title">#{room?.title ?? roomId}</h2>
            <p className="topic" data-testid="room-topic">
              {room?.topic}
            </p>
          </div>

          <div className="transports">
            <span className="transport" data-testid="transport-http">
              <span className={`dot dot--${lastCall.includes('· 200') ? 'live' : 'waiting'}`} />
              HTTP
              <span className="mono" data-testid="http-detail">
                {lastCall}
              </span>
            </span>
            <span className="transport" data-testid="transport-ws">
              <span className={`dot dot--${socketState}`} />
              WS
              <span className="mono" data-testid="ws-detail">
                {socketNote}
              </span>
            </span>
            <span className="transport" data-testid="transport-sse">
              <span className={`dot dot--${streamState}`} />
              SSE
              <span className="mono" data-testid="sse-detail">
                {streamNote}
              </span>
            </span>
            <button
              className="button button--ghost"
              data-testid="drop-socket"
              onClick={() => void dropSocket()}
              type="button"
            >
              Drop the socket
            </button>
          </div>
        </header>

        <div className="thread" ref={threadRef}>
          {hasMore && !historyError && (
            <button
              className="button button--ghost"
              data-testid="load-older"
              onClick={() => void loadOlder()}
              type="button"
            >
              Load older
            </button>
          )}

          {historyError && (
            <p className="note note--bad" data-testid="history-error">
              {historyError}
              <button
                className="button button--ghost"
                data-testid="load-older-retry"
                onClick={() => void loadOlder()}
                type="button"
              >
                Try again
              </button>
            </p>
          )}

          {roomError && (
            <p className="note note--bad" data-testid="room-error">
              {roomError}
            </p>
          )}

          <ul className="messages" data-testid="messages">
            {messages.map((message) => (
              <li
                className={message.authorId === me?.me.id ? 'message message--mine' : 'message'}
                data-testid="message"
                key={message.id}
              >
                <p className="message__meta">
                  <span data-testid="message-author">{nameOf(message.authorId)}</span>
                  <span className="mono">{clock(message.at)}</span>
                </p>
                <p className="message__text" data-testid="message-text">
                  {message.text}
                </p>

                {(Object.entries(message.reactions ?? {}).length > 0 || reactionsOn) && (
                  <p className="reactions">
                    {Object.entries(message.reactions ?? {}).map(([emoji, who]) => (
                      <span className="chip" data-testid="reaction-chip" key={emoji}>
                        {emoji} {who.length}
                      </span>
                    ))}
                    {reactionsOn &&
                      REACTIONS.map((emoji) => (
                        <button
                          aria-label={`React with ${emoji}`}
                          className="chip chip--add"
                          data-testid="reaction-add"
                          key={emoji}
                          onClick={() => void react(message, emoji)}
                          type="button"
                        >
                          {emoji}
                        </button>
                      ))}
                  </p>
                )}
              </li>
            ))}

            {outgoing.map((item) => (
              <li className="message message--mine message--pending" data-testid="outgoing" key={item.id}>
                <p className="message__text">{item.text}</p>
                <p className="message__meta">
                  {item.error ? (
                    <>
                      <span data-testid="outgoing-failed">Not sent</span>
                      <button
                        className="button button--ghost"
                        data-testid="outgoing-retry"
                        onClick={() => void send(item.text, item.id)}
                        type="button"
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    <span data-testid="outgoing-sending">Sending…</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <p className="typing" data-testid="typing">
          {others.length ? `${others.join(', ')} is typing…` : ''}
        </p>

        <form className="composer" onSubmit={submit}>
          <input
            aria-label="Message"
            className="input"
            data-testid="composer-input"
            onChange={(event) => {
              setDraft(event.target.value);
              notifyTyping();
            }}
            placeholder={`Message #${room?.title ?? roomId}`}
            value={draft}
          />
          <button className="button" data-testid="composer-send" type="submit">
            Send
          </button>
        </form>
      </main>

      <footer className="wire">
        <section className="log">
          <h2>What crossed the wire</h2>
          <ul data-testid="event-log">
            {events.map((entry) => (
              <li data-testid="event" key={entry.id}>
                <span className="mono when">{entry.at}</span>
                <span className={`tag tag--${entry.channel}`}>{entry.channel}</span>
                <span className="mono what">{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="hints">
          <h2>Reshape it from a terminal</h2>
          <ul className="mono">
            <li data-testid="cli-env">{`export MOCKSMITH_URI=${mockUri} MOCKSMITH_APP_URI=${appUri}`}</li>
            <li>npx mocksmith -c ./mocksmith.config.ts bot say &quot;the anvil is hot&quot;</li>
            <li>npx mocksmith -c ./mocksmith.config.ts scenario apply &quot;History gap&quot;</li>
            <li>npx mocksmith -c ./mocksmith.config.ts session set members.2.status &apos;&quot;online&quot;&apos;</li>
            <li data-testid="cli-raw">{`node bot.mjs --port ${rawPort} "hello from plain TCP"`}</li>
          </ul>
        </section>
      </footer>
    </div>
  );
};
