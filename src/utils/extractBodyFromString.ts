import { isJson, isTextContent } from './utils';

import { MockData } from '../types';

export function extractBodyFromString(
  responseBody: MockData['response']['body'],
  headers: MockData['response']['headers'] = {}
) {
  if (isTextContent(headers)) {
    return isJson(headers) ? JSON.stringify(responseBody) : responseBody;
  }

  // non-text content with a string body means base64
  if (typeof responseBody === 'string') {
    return Buffer.from(responseBody, 'base64');
  }

  if (Buffer.isBuffer(responseBody)) {
    return responseBody;
  }
}
