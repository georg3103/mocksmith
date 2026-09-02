import type { ChatApi, Message } from './types';

/**
 * The world every session starts from. `mocksmith session reset` restores
 * exactly this, and the Playwright fixture hands a copy of it to each test.
 * */

/**
 * Timestamps are derived from a fixed instant, not from `Date.now()`: the demo,
 * the screenshots and the assertions all want the same conversation every time.
 * */
const START = Date.parse('2026-03-14T09:00:00.000Z');

const conversation: [author: string, text: string][] = [
  ['u-grace', 'Morning. The coke delivery slipped to Thursday.'],
  ['u-ada', 'Thursday is fine, we still have most of a bag.'],
  ['u-grace', 'Half a bag. I weighed it.'],
  ['u-ada', 'Then Thursday is not fine.'],
  ['u-bot', 'Reminder: quench tank refilled 2 days ago.'],
  ['u-grace', 'I moved the tank closer to the anvil, by the way.'],
  ['u-ada', 'Good. I kept scorching my sleeve reaching over.'],
  ['u-grace', 'That is what the apron is for.'],
  ['u-ada', 'The apron is what I scorched last week.'],
  ['u-bot', 'Forge temperature holding at 1180 °C.'],
  ['u-grace', 'Are we still doing the hinge batch today?'],
  ['u-ada', 'Twelve of them. Six done, six drawn out and waiting.'],
  ['u-grace', 'Send a photo when the first pair is fitted.'],
  ['u-ada', 'Will do. The scrolls came out better than the drawing.'],
  ['u-grace', 'They always do. The drawing is the pessimistic version.'],
  ['u-bot', 'Anvil booked by Grace, 14:00–16:00.'],
  ['u-grace', 'I need it for the gate latch. Should not take the full slot.'],
  ['u-ada', 'Take it, I am filing all afternoon anyway.'],
  ['u-grace', 'Filing is punishment for punching holes too small.'],
  ['u-ada', 'It was one hole.'],
  ['u-grace', 'It was four.'],
  ['u-bot', 'Backup of the pattern book finished.'],
  ['u-ada', 'Do we have 8 mm round left, or did the railing eat it all?'],
  ['u-grace', 'Two lengths behind the door. Anything else is 10 mm.'],
  ['u-ada', 'Two is enough. Thanks.'],
  ['u-grace', 'Heating up now — shout if you need the second fire.'],
];

const build = (roomId: string, lines: typeof conversation, firstId: number): Message[] =>
  lines.map(([authorId, text], index) => ({
    at: new Date(START + index * 7 * 60_000).toISOString(),
    authorId,
    id: firstId + index,
    roomId,
    text,
  }));

export default {
  me: { id: 'u-ada', name: 'Ada', plan: 'pro' as 'free' | 'pro' },
  members: [
    { id: 'u-ada', name: 'Ada', status: 'online' as const },
    { id: 'u-grace', name: 'Grace', status: 'online' as const },
    { id: 'u-bot', name: 'Forge bot', status: 'away' as const },
  ],
  rooms: [
    { id: 'general', title: 'general', topic: 'Everything that is not the forge', unread: 0 },
    { id: 'forge', title: 'forge', topic: 'Hot metal only', unread: 2 },
  ],
  messages: {
    general: build('general', conversation, 1),
    forge: build(
      'forge',
      [
        ['u-bot', 'Fire lit at 08:12.'],
        ['u-grace', 'Second fire is banked, not out.'],
        ['u-ada', 'Leave it banked, I will want it after lunch.'],
      ],
      101
    ),
  },
  typing: [] as string[],
  /** Off by default: the `Busy room` scenario turns it on. */
  chatter: { on: false, everyMs: 2500 },
  /**
   * Read by `/api/me` and gating the reactions endpoint, so a flag flip is
   * visible on screen rather than only in the session dump.
   * */
  remoteConfigFlags: { REACTIONS: false },
} satisfies ChatApi;
