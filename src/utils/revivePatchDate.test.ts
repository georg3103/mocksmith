import { revivePatchDate } from './revivePatchDate';

describe('revivePatchDate', () => {
  test('turns an ISO date string into a real Date', () => {
    const result = revivePatchDate({ date: '2026-01-01T10:00:00Z' }) as { date: unknown };

    expect(result.date).toBeInstanceOf(Date);
    expect((result.date as Date).toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  test('leaves other fields alone', () => {
    const result = revivePatchDate({
      date: '2026-01-01T10:00:00Z',
      user: { name: 'Test' },
    }) as { user: unknown };

    expect(result.user).toEqual({ name: 'Test' });
  });

  test('a patch without a date passes through unchanged', () => {
    const patch = { remoteConfigFlags: { FLAG: true } };

    expect(revivePatchDate(patch)).toEqual(patch);
  });

  test('a non-string date is left alone', () => {
    const date = new Date('2026-01-01T10:00:00Z');

    expect((revivePatchDate({ date }) as { date: unknown }).date).toBe(date);
  });
});
