import * as http from 'http';
import * as url from 'url';

import { formDataBufferToObject } from './formDataBufferToObject';
import { streamToBuffer } from './streamToBuffer';

export async function parseRequest(req: http.IncomingMessage) {
  const parsedUrl = url.parse(req.url ?? '', true);

  const buffer = await streamToBuffer(req);

  let body;

  if (req.headers['content-type']?.includes('multipart/form-data')) {
    body = await formDataBufferToObject(buffer, req);
  } else {
    body = buffer.toString('utf8');
  }

  let res = body;

  try {
    if (body && typeof body === 'string') {
      res = JSON.parse(body);
    }
  } catch {
    // a non-JSON body is passed through as the raw string
  }

  return {
    path: parsedUrl.pathname as string,
    query: parsedUrl.query,
    body: res,
  };
}
