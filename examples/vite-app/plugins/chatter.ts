import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';

import type { ChatApi, Message } from '../types';

type ChatterOptions = {
  /** What the room says, in order. Deterministic, so a test can assert on it. */
  lines?: string[];
};

const DEFAULT_LINES = [
  'Grace: the latch is fitted, it swings true.',
  'Forge bot: quench tank topped up.',
  'Grace: second fire is up to heat if you want it.',
  'Forge bot: anvil free from 15:00.',
  'Grace: that scroll came out better than the drawing.',
  'Forge bot: coke delivery confirmed for Thursday.',
];

/** How often the plugin looks for sessions that are due a line. */
const TICK = 500;

/**
 * The room talking back.
 *
 * A scenario cannot do this on its own — a scenario is a description of the
 * world, not a process — so the two split the job the way they should: the
 * `Busy room` scenario sets `chatter.on`, and this plugin watches for it and
 * does the sending. Turn it off with the switch in the page, with
 * `mocksmith session set chatter.on false`, or with `session reset`.
 *
 * Each line is appended to the session *and* pushed into its sockets, so it
 * survives a reload — unlike a bare `sendToWebsocket`, which changes the page
 * and nothing else.
 * */
export const chatter = (options: ChatterOptions = {}): MocksmithPlugin => {
  const lines = options.lines?.length ? options.lines : DEFAULT_LINES;
  /** Per session: when it last spoke, and how far through the script it is. */
  const state = new Map<string, { at: number; index: number }>();

  return definePlugin({
    name: 'chat-chatter',

    serverStarted(ctx) {
      const tick = () => {
        const now = Date.now();

        for (const id of ctx.sessions.listIds()) {
          const session = ctx.sessions.getById(id);
          const data = session?.getApiData() as ChatApi | undefined;

          if (!session || !data?.chatter?.on) {
            state.delete(id);
            continue;
          }

          const seen = state.get(id) ?? { at: 0, index: 0 };

          if (now - seen.at < data.chatter.everyMs) {
            continue;
          }

          const [author, ...rest] = lines[seen.index % lines.length].split(': ');
          const speaker = data.members.find((member) => member.name === author);
          const message: Message = {
            at: new Date().toISOString(),
            authorId: speaker?.id ?? 'u-bot',
            id:
              Object.values(data.messages)
                .flat()
                .reduce((max, item) => Math.max(max, item.id), 0) + 1,
            roomId: 'general',
            text: rest.join(': '),
          };

          data.messages.general.push(message);
          state.set(id, { at: now, index: seen.index + 1 });

          void ctx.callSystemApi('sendToWebsocket', {
            id,
            data: { data: { type: 'message', message } },
          });
        }
      };

      const timer = setInterval(tick, TICK);

      // Nothing here should keep the process alive on its own.
      timer.unref();
      ctx.onClose(() => clearInterval(timer));
      ctx.logger.info('watching chatter.on — apply the "Busy room" scenario to hear it');
    },
  });
};
