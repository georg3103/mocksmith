import { endpointOptionParsers } from './parseEndpointOptions';

describe('parseHttpStatus', () => {
  test.each([
    ['1s', 'must be an integer'],
    ['99', 'between 100 and 599'],
    ['600', 'between 100 and 599'],
  ])('rejects %s', (value, message) => {
    expect(() => endpointOptionParsers.httpStatus(value)).toThrow(message);
  });

  test('returns a valid HTTP status', () => {
    expect(endpointOptionParsers.httpStatus('503')).toBe(503);
  });
});

describe('parseDelay', () => {
  test.each(['1s', '-1', 'Infinity'])('rejects %s', (value) => {
    expect(() => endpointOptionParsers.delay(value)).toThrow('must be a non-negative number');
  });

  test('returns a valid delay', () => {
    expect(endpointOptionParsers.delay('1500')).toBe(1500);
  });
});
