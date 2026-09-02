import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';

import type { ChatApi, Message } from '../types';

type SayRequest = { id?: string; room?: string; text?: string };

type BotOptions = {
  /** Which member the bot speaks as. Must exist in the session's `members`. */
  authorId?: string;
};

/**
 * A plugin written for this example, and small enough to read in one sitting.
 *
 * It adds one system route and one CLI command, which is the whole shape of
 * plugin authoring: `mocksmith bot say "the anvil is hot"` appends a message to
 * a session and pushes it into that session's open sockets, so the line lands
 * in the browser while you are still looking at the terminal.
 *
 * Note what it does *not* do: reach into the core's internals. The session
 * comes from `ctx.sessions`, the push goes through `ctx.callSystemApi` — the
 * same system API the CLI and the Playwright fixture speak.
 * */
export const bot = (options: BotOptions = {}): MocksmithPlugin => {
  const authorId = options.authorId ?? 'u-bot';

  return definePlugin({
    name: 'chat-bot',

    setup(ctx) {
      ctx.addSystemHandlers({
        // Reachable as POST /__mocks/api/bot/say
        'bot/say': (_api: unknown, { requestData }: { requestData: { body: SayRequest } }) => {
          const { id, room = 'general', text } = requestData.body ?? {};

          if (!text?.trim()) {
            return { response: { status: 400, body: { result: 'text-required' } } };
          }

          const session = id ? ctx.sessions.getById(id) : ctx.sessions.getDefaultSession();

          if (!session) {
            return {
              response: { status: 404, body: { result: 'no-session', known: ctx.sessions.listIds() } },
            };
          }

          const state = session.getApiData() as ChatApi;
          const messages = state.messages[room];

          if (!messages) {
            return { response: { status: 404, body: { result: 'no-room', room } } };
          }

          const message: Message = {
            at: new Date().toISOString(),
            authorId,
            id:
              Object.values(state.messages)
                .flat()
                .reduce((max, item) => Math.max(max, item.id), 0) + 1,
            roomId: room,
            text: text.trim(),
          };

          messages.push(message);

          // Fire-and-forget: the reply does not wait for the frame to land.
          void ctx.callSystemApi('sendToWebsocket', {
            id: session.id,
            // The system API takes an outgoing *message*, whose payload is `data`.
            data: { data: { type: 'message', message } },
          });

          return { response: { body: { result: 'ok', message } } };
        },
      });

      ctx.logger.info('`mocksmith bot say "…"` is available');
    },

    cli: [
      {
        name: 'bot',
        description: 'Speak into the chat as the bot',
        defaultSubcommand: 'say',
        commands: [
          {
            name: 'say',
            description: 'Post a message and push it into the open sockets',
            args: [{ name: 'text', required: true, description: 'what the bot says' }],
            options: [{ flags: '--room <room>', description: 'room id (default: general)' }],
            action: async (ctx, args, cliOptions) => {
              const result = await ctx.callApi<{ result: string }>('bot/say', {
                id: ctx.sessionId,
                room: cliOptions.room,
                text: String(args.text),
              });

              ctx.log.info(result.result === 'ok' ? 'Said it.' : `Failed: ${result.result}`);
            },
          },
        ],
      },
    ],
  });
};
