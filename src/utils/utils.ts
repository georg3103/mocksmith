/* eslint-disable no-console */
import crypto from 'crypto';
import pc from 'picocolors';

import { MockHeaders } from '../types';

export function generateHash(data: string): string {
  const hash = crypto.createHash('sha1').update(data).digest('hex');

  return hash.slice(0, 10);
}

export function isTextContent(headers: MockHeaders): boolean {
  const contentType = headers['content-type'] || headers['Content-Type'];

  if (!contentType) {
    return true;
  }

  if (typeof contentType !== 'string') {
    return false;
  }

  return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/.test(
    contentType
  );
}

export function isJson(headers: MockHeaders): boolean {
  const contentType = headers['content-type'] || headers['Content-Type'];

  if (typeof contentType !== 'string') {
    return false;
  }

  return contentType?.includes('application/json');
}

export function log(...args: string[]) {
  console.log(...args);
}

export function logFoundMock(name: string) {
  log(`✅  ${name}`);
}

export function logNotFoundMock(name: string) {
  log(`❌  ${pc.bgRed('Mock not found')} – ${pc.bgRed(name)}`);
}

/**
 * Stringifies an object, tolerating bigint values.
 * */
export function stringify(obj: object) {
  return JSON.stringify(obj, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}
