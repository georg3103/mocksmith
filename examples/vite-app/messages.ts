import type { ChatApi, Message } from './types';

/**
 * Ids are unique across rooms, so a message is addressable by id alone — that
 * is what `/api/messages/:id/reactions` relies on.
 * */
export const nextMessageId = (state: ChatApi) =>
  Object.values(state.messages)
    .flat()
    .reduce((max, message) => Math.max(max, message.id), 0) + 1;

export type NewMessage = {
  authorId: string;
  roomId?: string;
  text: string;
};

/**
 * Appends a message to a room in the live session.
 *
 * Everything that can speak in this demo — the HTTP handler, the `bot say`
 * plugin, the chatter plugin, the TCP client — goes through here, so a message
 * looks the same whichever door it came in by. Pushing the frame into the
 * sockets is left to the caller: each of them reaches the session differently.
 * */
export const postMessage = (state: ChatApi, { authorId, roomId = 'general', text }: NewMessage) => {
  const room = state.messages[roomId];

  if (!room) {
    throw new Error(`no room called ${roomId}`);
  }

  const message: Message = {
    at: new Date().toISOString(),
    authorId,
    id: nextMessageId(state),
    roomId,
    text,
  };

  room.push(message);

  return message;
};
