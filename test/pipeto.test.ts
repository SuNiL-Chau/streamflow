import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { pipeTo, push } from '../dist/index.esm.js';

describe('pipeTo', () => {
  it('pipes all chunks from source to sink', async () => {
    const { writer, readable } = push({ highWaterMark: 10 });
    await writer.write('hello');
    await writer.write(' world');
    writer.end();

    const received = [];
    const sink = {
      get desiredSize() {
        return 10;
      },
      async writev(chunks) {
        for (const c of chunks) received.push(c);
      },
      end() {},
      abort() {},
    };

    await pipeTo(readable, sink);
    const text = new TextDecoder().decode(Buffer.concat(received.map((c) => Buffer.from(c))));
    assert.strictEqual(text, 'hello world');
  });

  it('calls sink.end() when source finishes (default preventClose=false)', async () => {
    const { writer, readable } = push({ highWaterMark: 10 });
    await writer.write('data');
    writer.end();

    let ended = false;
    const sink = {
      get desiredSize() {
        return 10;
      },
      async writev() {},
      end() {
        ended = true;
      },
      abort() {},
    };

    await pipeTo(readable, sink);
    assert.strictEqual(ended, true);
  });

  it('does NOT call sink.end() when preventClose=true', async () => {
    const { writer, readable } = push({ highWaterMark: 10 });
    await writer.write('data');
    writer.end();

    let ended = false;
    const sink = {
      get desiredSize() {
        return 10;
      },
      async writev() {},
      end() {
        ended = true;
      },
      abort() {},
    };

    await pipeTo(readable, sink, { preventClose: true });
    assert.strictEqual(ended, false);
  });

  it('aborts sink and throws when AbortSignal is pre-aborted', async () => {
    const { readable } = push({ highWaterMark: 10 });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    let abortCalled = false;
    const sink = {
      get desiredSize() {
        return 10;
      },
      async writev() {},
      end() {},
      abort() {
        abortCalled = true;
      },
    };

    await assert.rejects(() => pipeTo(readable, sink, { signal: controller.signal }), /cancelled/);
    assert.strictEqual(abortCalled, true);
  });

  it('aborts mid-pipe when AbortSignal fires', async () => {
    // Use a pre-written push stream (no background loops) for determinism
    const { writer, readable } = push({ highWaterMark: 100, backpressure: 'drop-newest' });
    const controller = new AbortController();

    // Write all chunks synchronously before reading
    for (let i = 0; i < 20; i++) {
      await writer.write(`chunk${i}`);
    }
    writer.end();

    let callCount = 0;
    let aborted = false;
    const sink = {
      get desiredSize() {
        return 100;
      },
      async writev() {
        callCount++;
        if (callCount === 1) {
          // Abort on first writev call
          controller.abort(new Error('stop'));
        }
      },
      end() {},
      abort() {
        aborted = true;
      },
    };

    await assert.rejects(() => pipeTo(readable, sink, { signal: controller.signal }), /stop/);
    assert.strictEqual(aborted, true);
  });

  it('preventAbort=true skips aborting the sink when signal fires', async () => {
    // Pre-aborted signal — simplest way to test preventAbort
    const { readable } = push({ highWaterMark: 10 });
    const controller = new AbortController();
    controller.abort(new Error('nope'));

    let abortCalled = false;
    const sink = {
      get desiredSize() {
        return 10;
      },
      async writev() {},
      end() {},
      abort() {
        abortCalled = true;
      },
    };

    await assert.rejects(() =>
      pipeTo(readable, sink, { signal: controller.signal, preventAbort: true }),
    );
    assert.strictEqual(abortCalled, false);
  });
});
