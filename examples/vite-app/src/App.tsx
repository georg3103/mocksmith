import { useCallback, useEffect, useMemo, useState } from 'react';

import type { FormEvent } from 'react';

type Todo = { id: number; title: string; done: boolean };
type User = { name: string; plan: 'free' | 'pro' };
type Board = { user: User; todos: Todo[] };

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

type TransportState = 'waiting' | 'live' | 'down';

type Progress = { done: number; total: number; plan: string; at: string };

type Channel = 'http' | 'ws' | 'sse';
type LogEntry = { id: number; at: string; channel: Channel; text: string };

const LOG_LENGTH = 14;

let entryId = 0;

/**
 * Every call goes to the mock server through the Vite proxy, so the app and
 * the mocks share an origin and the session cookie travels along.
 * */
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'request failed'}`);
  }

  return (await response.json()) as T;
};

const clockOf = (iso: string) => new Date(iso).toLocaleTimeString();

/** Injected by vite.config.ts, which is the only place that knows the port. */
const mockUri = (import.meta.env.VITE_MOCKSMITH_URI as string | undefined) ?? 'http://localhost:3001';
const appUri = typeof location === 'undefined' ? '' : location.origin;

export const App = () => {
  const [board, setBoard] = useState<Loadable<Board>>({ status: 'loading' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCall, setLastCall] = useState('—');
  const [socketState, setSocketState] = useState<TransportState>('waiting');
  const [socketNote, setSocketNote] = useState('connecting…');
  const [streamState, setStreamState] = useState<TransportState>('waiting');
  const [streamNote, setStreamNote] = useState('connecting…');
  const [events, setEvents] = useState<LogEntry[]>([]);

  /**
   * One line per thing that actually crossed the wire. Chrome's Network panel
   * only records a websocket while it is open, and SSE events hide inside the
   * EventStream tab of a single request — so the page keeps its own log and
   * you can see all three transports without opening the inspector at all.
   * */
  const logEvent = useCallback((channel: Channel, text: string) => {
    entryId += 1;

    const entry: LogEntry = {
      id: entryId,
      at: new Date().toLocaleTimeString(),
      channel,
      text,
    };

    setEvents((current) => [entry, ...current].slice(0, LOG_LENGTH));
  }, []);

  const loadBoard = useCallback(async () => {
    setBoard({ status: 'loading' });

    try {
      const data = await request<Board>('/api/board');

      setBoard({ status: 'ready', data });
      setLastCall('GET /api/board · 200');
      logEvent('http', 'GET /api/board · 200');
    } catch (error) {
      setBoard({ status: 'error', message: (error as Error).message });
      setLastCall(`GET /api/board · ${(error as Error).message}`);
      logEvent('http', `GET /api/board · ${(error as Error).message}`);
    }
  }, [logEvent]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    /**
     * The websocket is served by the same session as the REST calls: an HTTP
     * handler pushes the new list into it, so a second tab stays in step.
     *
     * A websocket does not reconnect by itself (an EventSource does), so this
     * reopens it with a backoff. Restart the mock server and the page finds it
     * again instead of sitting there dead.
     * */
    const connect = () => {
      socket = new WebSocket(`ws://${location.host}/ws`);

      socket.addEventListener('open', () => {
        socket?.send('ping');
        logEvent('ws', attempt > 0 ? '↑ ping (reconnected)' : '↑ ping');

        if (attempt > 0) {
          // The connection was down for a while — the world may have moved on.
          void loadBoard();
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
        logEvent('ws', `connection lost · retrying in ${backoff / 1000}s`);
        retryTimer = setTimeout(connect, backoff);
      });

      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          at?: string;
          todos?: Todo[];
        };

        setSocketState('live');

        if (message.type === 'pong' && message.at) {
          setSocketNote(`pong ${clockOf(message.at)}`);
          logEvent('ws', '↓ pong');
        }

        if (message.type === 'todos' && message.todos) {
          logEvent('ws', `↓ todos · ${message.todos.length} item(s) pushed by the server`);
          setBoard((current) =>
            current.status === 'ready'
              ? { status: 'ready', data: { ...current.data, todos: message.todos as Todo[] } }
              : current
          );
        }
      });
    };

    connect();

    let stream: EventSource | undefined;
    let lastBeat = Date.now();
    let beats = 0;
    let lastProgress = '';

    // An EventSource reconnects on its own; `readyState` says whether this
    // error is a retry in progress or the end of the stream.
    const openStream = () => {
      stream = new EventSource('/sse/progress');

      stream.addEventListener('error', () => {
        const retrying = stream?.readyState === EventSource.CONNECTING;

        setStreamState(retrying ? 'waiting' : 'down');
        setStreamNote(retrying ? 'reconnecting…' : 'closed');
        logEvent('sse', retrying ? 'stream error · reconnecting' : 'stream closed');
      });
      stream.addEventListener('message', (event) => {
        const next = JSON.parse(String(event.data)) as Progress;
        const progress = `${next.done}/${next.total} done`;

        lastBeat = Date.now();
        beats += 1;
        setStreamState('live');
        setStreamNote(`${progress} · beat ${beats}`);

        // Every beat in the log would drown everything else, so only changes
        // are recorded — the beat counter above is the liveness indicator.
        if (progress !== lastProgress) {
          logEvent('sse', beats === 1 ? `stream open · ${progress}` : `↓ ${progress}`);
          lastProgress = progress;
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
      logEvent('sse', 'no beat for 5s · reopening the stream');
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
  }, [loadBoard, logEvent]);

  /** Every mutation answers with the whole list, so the page never guesses. */
  const mutate = async (label: string, url: string, init: RequestInit) => {
    setBusy(true);

    try {
      const { todos } = await request<{ todos: Todo[] }>(url, init);

      setBoard((current) =>
        current.status === 'ready' ? { status: 'ready', data: { ...current.data, todos } } : current
      );
      setLastCall(`${label} · 200`);
      logEvent('http', `${label} · 200`);
    } catch (error) {
      setLastCall(`${label} · ${(error as Error).message}`);
      logEvent('http', `${label} · ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const addTodo = async (event: FormEvent) => {
    event.preventDefault();

    const title = draft.trim();

    if (!title) {
      return;
    }

    setDraft('');
    await mutate('POST /api/todos', '/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  };

  const toggleTodo = (todo: Todo) =>
    mutate(`PATCH /api/todos/${todo.id}`, `/api/todos/${todo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: !todo.done }),
    });

  const removeTodo = (todo: Todo) =>
    mutate(`DELETE /api/todos/${todo.id}`, `/api/todos/${todo.id}`, { method: 'DELETE' });

  const todos = board.status === 'ready' ? board.data.todos : [];
  const left = useMemo(() => todos.filter((todo) => !todo.done).length, [todos]);

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <p className="eyebrow">mocksmith example</p>
          <h1>The Forge Board</h1>
        </div>
        {board.status === 'ready' && (
          <p className="who">
            <span data-testid="user-name">{board.data.user.name}</span>
            <span className={`plan plan--${board.data.user.plan}`} data-testid="user-plan">
              {board.data.user.plan}
            </span>
          </p>
        )}
      </header>

      <section className="transports" aria-label="Transports">
        <article className="transport" data-testid="transport-http">
          <span className={`dot dot--${board.status === 'error' ? 'down' : 'live'}`} />
          <h2>HTTP</h2>
          <p className="mono" data-testid="http-detail">
            {lastCall}
          </p>
        </article>

        <article className="transport" data-testid="transport-ws">
          <span className={`dot dot--${socketState}`} />
          <h2>WebSocket</h2>
          <p className="mono" data-testid="ws-detail">
            {socketNote}
          </p>
        </article>

        <article className="transport" data-testid="transport-sse">
          <span className={`dot dot--${streamState}`} />
          <h2>SSE</h2>
          <p className="mono" data-testid="sse-detail">
            {streamNote}
          </p>
        </article>
      </section>

      <main className="board">
        <form className="composer" onSubmit={addTodo}>
          <input
            aria-label="What needs doing?"
            className="input"
            data-testid="new-todo"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What needs doing?"
            value={draft}
          />
          <button className="button" data-testid="add-todo" disabled={busy} type="submit">
            Add
          </button>
        </form>

        {board.status === 'loading' && (
          <p className="note" data-testid="board-loading">
            Loading the board…
          </p>
        )}

        {board.status === 'error' && (
          <div className="note note--bad" data-testid="board-error">
            <p>The board is unavailable: {board.message}</p>
            <button className="button button--ghost" data-testid="retry" onClick={() => void loadBoard()} type="button">
              Try again
            </button>
          </div>
        )}

        {board.status === 'ready' && todos.length === 0 && (
          <p className="note" data-testid="board-empty">
            Nothing on the board. Add the first task.
          </p>
        )}

        {todos.length > 0 && (
          <ul className="list">
            {todos.map((todo) => (
              <li className={todo.done ? 'row row--done' : 'row'} data-testid="todo" key={todo.id}>
                <label className="check">
                  <input
                    checked={todo.done}
                    data-testid="todo-toggle"
                    onChange={() => void toggleTodo(todo)}
                    type="checkbox"
                  />
                  <span data-testid="todo-title">{todo.title}</span>
                </label>
                <button
                  aria-label={`Delete ${todo.title}`}
                  className="remove"
                  data-testid="todo-delete"
                  onClick={() => void removeTodo(todo)}
                  type="button"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {board.status === 'ready' && todos.length > 0 && (
          <p className="tally" data-testid="tally">
            {left} of {todos.length} left
          </p>
        )}
      </main>

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

      <footer className="hints">
        <p>
          Reshape this page from another terminal, in <code>examples/vite-app</code> — it reloads by
          itself:
        </p>
        <ul className="mono">
          <li data-testid="cli-env">{`export MOCKSMITH_URI=${mockUri} MOCKSMITH_APP_URI=${appUri}`}</li>
          <li>npx mocksmith -c ./mocksmith.config.ts scenario apply "Flaky board"</li>
          <li>npx mocksmith -c ./mocksmith.config.ts session set user.plan '"free"'</li>
          <li>npx mocksmith -c ./mocksmith.config.ts endpoint set /api/board --status 503</li>
          <li>npx mocksmith -c ./mocksmith.config.ts session reset</li>
        </ul>
      </footer>
    </div>
  );
};
