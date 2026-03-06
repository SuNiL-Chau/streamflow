import type { PushOptions, ReadableBatchStream } from '../types.js';
import { type Transform, pull } from './pull.js';
import { push } from './push.js';

export interface SharedStream {
  pull(...transforms: Transform[]): ReadableBatchStream;
}

export function share(source: ReadableBatchStream, options?: PushOptions): SharedStream {
  const consumers: ReturnType<typeof push>[] = [];

  // Start consuming the source immediately or on first pull?
  // Let's start consuming as soon as we have at least one consumer.
  let isConsuming = false;

  async function consume() {
    isConsuming = true;
    try {
      for await (const batch of source) {
        if (consumers.length === 0) {
          // If no consumers, maybe we should drop or buffer?
          continue;
        }

        // Write to all consumers.
        // Wait for all to handle backpressure.
        // writev() returns void | Promise<void> — Promise.resolve() normalises both to a real Promise
        // so Promise.all() always receives an iterable of Thenables.
        await Promise.all(consumers.map((c) => Promise.resolve(c.writer.writev(batch))));
      }

      // End all consumers
      for (const consumer of consumers) {
        consumer.writer.end();
      }
    } catch (error) {
      // Abort all consumers on source error
      for (const consumer of consumers) {
        consumer.writer.abort(error);
      }
    }
  }

  return {
    pull(...transforms: Transform[]): ReadableBatchStream {
      const consumer = push(options);
      consumers.push(consumer);

      if (!isConsuming) {
        consume().catch(console.error);
      }

      if (transforms.length > 0) {
        return pull(consumer.readable, ...transforms);
      }

      return consumer.readable;
    },
  };
}
