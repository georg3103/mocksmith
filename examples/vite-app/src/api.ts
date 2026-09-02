import type { Member, Message, Room } from '../types';

export type Me = {
  /** Whether the room talks back on its own — see the chatter plugin. */
  chatter: { everyMs: number; on: boolean };
  flags: Record<string, boolean>;
  me: { id: string; name: string; plan: 'free' | 'pro' };
  /** The page drives the system API, so it has to name its own session. */
  sessionId: string;
};

export type RoomSummary = Room & { lastAt?: string; preview: string };

export type HistoryPage = { hasMore: boolean; messages: Message[]; room: Room };

export type ScenarioSummary = {
  description?: string;
  endpoints: number;
  feature?: string;
  name: string;
  order?: number;
};

export type Roster = { at: string; members: Member[]; typing: string[]; unread: number };

/**
 * Every call goes to the mock server through the Vite proxy, so the app and
 * the mocks share an origin and the session cookie travels along.
 * */
export const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'request failed'}`);
  }

  return (await response.json()) as T;
};

const query = (before?: number) => (before ? `?before=${before}` : '');

export const api = {
  me: () => request<Me>('/api/me'),
  rooms: () => request<{ rooms: RoomSummary[] }>('/api/rooms'),
  history: (roomId: string, before?: number) =>
    request<HistoryPage>(`/api/rooms/${roomId}/messages${query(before)}`),
  /** Sending has a path of its own so a scenario can break it alone. */
  send: (roomId: string, text: string) =>
    request<{ message: Message }>(`/api/rooms/${roomId}/outbox`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  read: (roomId: string) =>
    request<{ room: Room }>(`/api/rooms/${roomId}/read`, { method: 'POST', body: '{}' }),
  react: (messageId: number, emoji: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
};

/**
 * The system API — the very routes the CLI and the Playwright fixture speak.
 * Reaching it from the page is what turns the scenario menu into a real dev
 * tool instead of a mock of one.
 * */
export const system = <T>(route: string, body: Record<string, unknown>) =>
  request<T>(`/__mocks/api/${route}`, { method: 'POST', body: JSON.stringify(body) });

/** Injected by vite.config.ts, the only place that knows the ports. */
export const mockUri = (import.meta.env.VITE_MOCKSMITH_URI as string) ?? 'http://localhost:3001';
export const rawPort = (import.meta.env.VITE_MOCKSMITH_RAW_PORT as string) ?? '3411';
