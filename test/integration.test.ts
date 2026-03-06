import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { push, share, text } from '../dist/index.esm.js';

describe('Integration Tests', () => {
  it('Stream.share multi-consumer pipeline', async () => {
    // Producer pipeline
    const { writer, readable } = push({ highWaterMark: 100 });

    // Create shared stream
    const shared = share(readable);

    // Consumer A (raw text)
    const consumerA = shared.pull();

    // Consumer B (uppercase transform)
    const consumerB = shared.pull((chunk: Uint8Array) => {
      const str = new TextDecoder().decode(chunk);
      return [new TextEncoder().encode(str.toUpperCase())];
    });

    writer.write('hello');
    writer.write(' ');
    writer.write('world');
    writer.end();

    // Await both pipelines
    const [resultA, resultB] = await Promise.all([text(consumerA), text(consumerB)]);

    assert.strictEqual(resultA, 'hello world');
    assert.strictEqual(resultB, 'HELLO WORLD');
  });
});
