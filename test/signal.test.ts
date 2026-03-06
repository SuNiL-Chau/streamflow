import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { StreamCancelledError, pipeTo, pull, push } from '../dist/index.esm.js';

describe('AbortSignal integration', () => {
  describe('push() with AbortSignal', () => {
    it('pre-aborted signal prevents all writes', async () => {
      const controller = new AbortController();
      controller.abort(new Error('pre-aborted'));

      const { writer, readable } = push({
        highWaterMark: 10,
        signal: controller.signal,
      });

      // The writer should be in aborted state
      // Reading should reject immediately
      const iter = readable[Symbol.asyncIterator]();
      await assert.rejects(() => iter.next(), /Stream/);
    });

    it('signal fired mid-stream aborts the readable', async () => {
      const controller = new AbortController();
      const { writer, readable } = push({
        highWaterMark: 50,
        signal: controller.signal,
      });

      await writer.write('chunk1');
      await writer.write('chunk2');

      // Read first batch, then abort before we read more
      const iter = readable[Symbol.asyncIterator]();
      await iter.next(); // consume what's buffered

      // Now abort the signal — next read should reject
      controller.abort(new Error('aborted mid-stream'));

      await assert.rejects(() => iter.next(), /aborted mid-stream/);
    });

    it('aborted stream rejects further writes gently', async () => {
      const controller = new AbortController();
      const { writer } = push({ highWaterMark: 10, signal: controller.signal });

      controller.abort(new Error('done'));

      // write after abort: should silently return (not throw)
      await assert.doesNotReject(async () => {
        await writer.write('ignored');
      });
    });
  });

  describe('pull() with AbortSignal', () => {
    it('pre-aborted signal throws immediately on iteration', async () => {
      const { writer, readable } = push({ highWaterMark: 10 });
      await writer.write('data');
      writer.end();

      const controller = new AbortController();
      controller.abort(new Error('cancelled-before-pull'));

      const pipeline = pull(readable, { signal: controller.signal });

      await assert.rejects(async () => {
        for await (const _ of pipeline) {
          /* should not reach here */
        }
      }, /cancelled-before-pull/);
    });

    it('signal fired mid-pull stops iteration', async () => {
      const controller = new AbortController();
      const { writer, readable } = push({ highWaterMark: 50 });

      // Write data in background
      (async () => {
        for (let i = 0; i < 20; i++) {
          await writer.write(`chunk${i} `.repeat(10));
        }
        writer.end();
      })().catch(() => {});

      let count = 0;
      const pipeline = pull(readable, { signal: controller.signal });

      await assert.rejects(async () => {
        for await (const batch of pipeline) {
          count++;
          if (count === 2) {
            controller.abort(new Error('stop-pull'));
          }
        }
      }, /stop-pull/);

      assert.ok(count >= 2, 'Should have processed at least 2 batches before abort');
    });

    it('aborted pipeline propagates StreamCancelledError', async () => {
      const { writer, readable } = push({ highWaterMark: 10 });
      await writer.write('x');
      writer.end();

      const controller = new AbortController();
      controller.abort('my reason');

      const pipeline = pull(readable, { signal: controller.signal });

      const err = await pipeline[Symbol.asyncIterator]()
        .next()
        .catch((e) => e);
      assert.ok(err instanceof StreamCancelledError || err instanceof Error);
    });
  });

  describe('pipeTo() with AbortSignal', () => {
    it('StreamCancelledError is thrown when signal fires', async () => {
      const { writer, readable } = push({ highWaterMark: 50 });
      const controller = new AbortController();

      (async () => {
        for (let i = 0; i < 50; i++) {
          await writer.write('data');
        }
        writer.end();
      })().catch(() => {});

      let calls = 0;
      const sink = {
        get desiredSize() {
          return 50;
        },
        async write() {},
        async writev() {
          calls++;
          if (calls === 1) controller.abort(new Error('pipe-cancelled'));
          await new Promise((r) => setTimeout(r, 10));
        },
        end() {},
        abort() {},
      };

      const err = await pipeTo(readable, sink, { signal: controller.signal }).catch((e) => e);
      assert.ok(err instanceof Error);
      assert.match(err.message, /pipe-cancelled/);
    });
  });

  describe('StreamCancelledError', () => {
    it('has correct name and message from Error reason', () => {
      const reason = new Error('timeout');
      const err = new StreamCancelledError(reason);
      assert.strictEqual(err.name, 'StreamCancelledError');
      assert.match(err.message, /timeout/);
      assert.strictEqual(err.reason, reason);
    });

    it('has correct name and message from string reason', () => {
      const err = new StreamCancelledError('user aborted');
      assert.match(err.message, /user aborted/);
    });

    it('works with no reason', () => {
      const err = new StreamCancelledError();
      assert.strictEqual(err.name, 'StreamCancelledError');
      assert.ok(err.message.length > 0);
    });
  });
});
