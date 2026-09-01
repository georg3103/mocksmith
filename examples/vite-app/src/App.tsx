import { useEffect, useState } from 'react';

type Profile = { name: string; plan: 'free' | 'pro' };
type Item = { id: number; title: string; price: number };

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

const load = async <T,>(url: string): Promise<Loadable<T>> => {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return { status: 'error', message: `${response.status} ${response.statusText}` };
    }

    return { status: 'ready', data: (await response.json()) as T };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
};

export const App = () => {
  const [profile, setProfile] = useState<Loadable<Profile>>({ status: 'loading' });
  const [items, setItems] = useState<Loadable<{ items: Item[] }>>({ status: 'loading' });
  const [notification, setNotification] = useState<string>();
  const [tick, setTick] = useState<number>();

  useEffect(() => {
    void load<Profile>('/api/profile').then(setProfile);
    void load<{ items: Item[] }>('/api/items').then(setItems);

    // The mock server serves this socket from the same session as the REST
    // calls above, so a handler can push into it.
    const socket = new WebSocket(`ws://${location.host}/ws`);

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; text?: string };

      if (message.type === 'notification') {
        setNotification(message.text);
      }
    });

    const stream = new EventSource('/sse/ticks');

    stream.addEventListener('message', (event) => {
      setTick((JSON.parse(String(event.data)) as { tick: number }).tick);
    });

    return () => {
      // Closing a socket that is still CONNECTING throws it away before the
      // handshake finishes, so wait for it to open first.
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      } else {
        socket.addEventListener('open', () => socket.close());
      }

      stream.close();
    };
  }, []);

  const reloadItems = () => {
    setItems({ status: 'loading' });
    void load<{ items: Item[] }>('/api/items').then(setItems);
  };

  return (
    <main>
      <h1>mocksmith shop</h1>

      <section>
        <h2>Profile</h2>
        {profile.status === 'loading' && <p data-testid="profile-loading">Loading…</p>}
        {profile.status === 'error' && (
          <p data-testid="profile-error">Could not load the profile: {profile.message}</p>
        )}
        {profile.status === 'ready' && (
          <p>
            <span data-testid="profile-name">{profile.data.name}</span>
            {' — '}
            <span data-testid="profile-plan">{profile.data.plan}</span>
          </p>
        )}
      </section>

      <section>
        <h2>Items</h2>
        <button type="button" data-testid="reload-items" onClick={reloadItems}>
          Reload
        </button>
        {items.status === 'loading' && <p data-testid="items-loading">Loading…</p>}
        {items.status === 'error' && (
          <p data-testid="items-error">Items are unavailable: {items.message}</p>
        )}
        {items.status === 'ready' && items.data.items.length === 0 && (
          <p data-testid="items-empty">Nothing in stock right now.</p>
        )}
        {items.status === 'ready' && items.data.items.length > 0 && (
          <ul data-testid="items">
            {items.data.items.map((item) => (
              <li key={item.id} data-testid="item">
                {item.title} — {item.price}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Live</h2>
        <button
          type="button"
          data-testid="notify"
          onClick={() => {
            void fetch('/api/notify');
          }}
        >
          Ask the server to notify me
        </button>
        {notification && <p data-testid="notification">{notification}</p>}
        {tick !== undefined && <p data-testid="tick">tick {tick}</p>}
      </section>
    </main>
  );
};
