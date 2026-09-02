import type { MocksAPI } from 'mocksmith';

export type MemberStatus = 'away' | 'offline' | 'online';

export type Member = {
  id: string;
  name: string;
  status: MemberStatus;
};

export type Room = {
  id: string;
  title: string;
  topic: string;
  unread: number;
};

/**
 * Ids are numbers, and that is load-bearing rather than cosmetic: the history
 * cursor travels as `?before=<id>`, which lets an override rule select on it
 * with `when: { query: { before: '>0' } }` — "any page of history except the
 * first one". A string id would only ever match exactly.
 * */
export type Message = {
  at: string;
  authorId: string;
  id: number;
  reactions?: Record<string, string[]>;
  roomId: string;
  text: string;
};

export type ChatApi = MocksAPI & {
  /**
   * Whether the room talks back, and how often. A scenario flips this; the
   * chatter plugin is what watches it and does the sending.
   * */
  chatter: { everyMs: number; on: boolean };
  me: { id: string; name: string; plan: 'free' | 'pro' };
  members: Member[];
  /** Keyed by room id. */
  messages: Record<string, Message[]>;
  remoteConfigFlags: { REACTIONS: boolean };
  rooms: Room[];
  /** Names of whoever is typing right now, written by the websocket handler. */
  typing: string[];
};
