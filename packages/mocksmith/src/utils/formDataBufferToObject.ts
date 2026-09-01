import * as http from 'http';
import { getBoundary, parse } from 'parse-multipart-data';

type ParsedValue = ReturnType<typeof parse>[number];

export async function formDataBufferToObject(buffer: Buffer, req: http.IncomingMessage) {
  const boundary = getBoundary(req.headers['content-type'] ?? '');

  const bufferParts = parse(buffer, boundary);

  const parts = bufferParts.reduce<Record<string, string | ParsedValue>>((acc, part) => {
    if (part.name) {
      acc[part.name] = part.filename ? part : part.data.toString('utf8');
    }

    return acc;
  }, {});

  return parts;
}
