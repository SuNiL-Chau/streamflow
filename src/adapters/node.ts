import { Readable } from 'node:stream';
import type { ReadableBatchStream } from '../types.js';

export async function* fromNode(stream: NodeJS.ReadableStream): ReadableBatchStream {
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) {
      yield [chunk];
    } else if (chunk && typeof (chunk as { byteLength?: number }).byteLength === 'number') {
      // biome-ignore lint/suspicious/noExplicitAny: node streams can yield arbitrary buffer-like objects
      yield [new Uint8Array((chunk as any).buffer || chunk)];
    } else if (typeof chunk === 'string') {
      yield [new TextEncoder().encode(chunk)];
    } else {
      throw new TypeError(`Unsupported chunk type in fromNode: ${typeof chunk}`);
    }
  }
}

export function toNode(source: ReadableBatchStream): NodeJS.ReadableStream {
  return Readable.from(
    (async function* () {
      for await (const batch of source) {
        for (const chunk of batch) {
          yield chunk;
        }
      }
    })(),
  );
}
