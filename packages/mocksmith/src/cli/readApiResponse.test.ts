import { readApiResponse } from './readApiResponse';

describe('readApiResponse', () => {
  test('returns the JSON of a successful response', async () => {
    await expect(
      readApiResponse<{ result: string }>(
        'getSession',
        new Response('{"result":"ok"}', { status: 200 })
      )
    ).resolves.toEqual({ result: 'ok' });
  });

  test('surfaces the HTTP status and the raw non-JSON error body', async () => {
    await expect(
      readApiResponse('getSession', new Response('Internal Server Error', { status: 500 }))
    ).rejects.toThrow('getSession responded with 500: Internal Server Error');
  });

  test('explains malformed JSON in a successful response', async () => {
    await expect(
      readApiResponse('getSession', new Response('not json', { status: 200 }))
    ).rejects.toThrow('getSession responded with malformed JSON: not json');
  });
});
