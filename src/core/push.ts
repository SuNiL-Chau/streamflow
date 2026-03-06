import {
  StreamAbortError,
  StreamBackpressureError,
  StreamCancelledError,
  StreamClosedError,
} from '../errors.js';
import type { BackpressureStrategy, PushOptions, PushResult, Writer } from '../types.js';
import { Queue } from './queue.js';

// I1: Module-level singleton — avoid per-write allocation
const encoder = new TextEncoder();

class PushStreamController implements Writer {
  private readonly buffer: Queue<Uint8Array> = new Queue<Uint8Array>();
  private readonly highWaterMark: number;
  private readonly strategy: BackpressureStrategy;

  private isEnded = false;
  private abortReason: unknown = null;

  private readonly pullQueue: Queue<{
    resolve: (value: IteratorResult<Uint8Array[]>) => void;
    reject: (reason: unknown) => void;
  }> = new Queue<{
    resolve: (value: IteratorResult<Uint8Array[]>) => void;
    reject: (reason: unknown) => void;
  }>();

  // To handle the 'block' backpressure strategy
  private readonly writeQueue: Queue<{ resolve: () => void }> = new Queue<{
    resolve: () => void;
  }>();

  constructor(options: PushOptions = {}) {
    this.highWaterMark = options.highWaterMark ?? 1024 * 16;
    this.strategy = options.backpressure ?? 'strict';

    // F6: AbortSignal integration
    if (options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        this.abortReason = new StreamCancelledError(signal.reason);
      } else {
        const onAbort = () => {
          this.abort(new StreamCancelledError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  }

  // F7: desiredSize getter — how much buffer space is left
  get desiredSize(): number | null {
    if (this.isEnded || this.abortReason) return null;
    return this.highWaterMark - this.buffer.length;
  }

  private toError(reason: unknown): Error {
    return reason instanceof Error ? reason : new StreamAbortError(String(reason));
  }

  private processWaiters() {
    if (this.pullQueue.length > 0) {
      if (this.buffer.length > 0) {
        const batch = this.buffer.drain();
        const waiter = this.pullQueue.dequeue();
        waiter?.resolve({ value: batch, done: false });
        this.resolveBlockedWriters(); // We drained buffer, unblock writers
      } else if (this.isEnded) {
        while (this.pullQueue.length > 0) {
          const waiter = this.pullQueue.dequeue();
          waiter?.resolve({ value: undefined, done: true });
        }
      } else if (this.abortReason) {
        while (this.pullQueue.length > 0) {
          const waiter = this.pullQueue.dequeue();
          waiter?.reject(this.toError(this.abortReason));
        }
      }
    }
  }

  private resolveBlockedWriters() {
    while (this.writeQueue.length > 0 && this.buffer.length < this.highWaterMark) {
      const writer = this.writeQueue.dequeue();
      writer?.resolve();
    }
  }

  private applyBackpressure(): void | Promise<void> {
    if (this.buffer.length >= this.highWaterMark) {
      switch (this.strategy) {
        case 'strict':
          throw new StreamBackpressureError({
            hwm: this.highWaterMark,
            current: this.buffer.length,
            strategy: this.strategy,
          });
        case 'drop-oldest':
          this.buffer.dequeue(); // Drop the oldest chunk
          break;
        case 'drop-newest':
          this.buffer.pop(); // Drop the chunk at the end of the queue
          break;
        case 'block':
          return new Promise<void>((resolve) => {
            this.writeQueue.enqueue({ resolve });
          });
      }
    }
  }

  async write(chunk: Uint8Array | string): Promise<void> {
    // I6: Throw on write-after-end
    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return;

    const data = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;

    if (this.buffer.length >= this.highWaterMark && this.strategy === 'drop-newest') {
      return; // Drop newest (the incoming chunk) by doing nothing
    }

    const wait = this.applyBackpressure();
    if (wait) await wait;

    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return; // double check after async wait

    this.buffer.enqueue(data);
    this.processWaiters();
  }

  // I2 + F8: Atomic writev — enqueue all chunks in one pass before notifying waiters
  async writev(chunks: Uint8Array[]): Promise<void> {
    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return;
    if (chunks.length === 0) return;

    // Handle 'block' backpressure: wait until there's space for at least one chunk
    if (this.strategy === 'block' && this.buffer.length >= this.highWaterMark) {
      await new Promise<void>((resolve) => {
        this.writeQueue.enqueue({ resolve });
      });
      if (this.isEnded) throw new StreamClosedError();
      if (this.abortReason) return;
    }

    // Enqueue all chunks atomically, applying drop strategies inline
    for (const chunk of chunks) {
      if (this.strategy === 'drop-newest' && this.buffer.length >= this.highWaterMark) {
        break; // Drop all remaining incoming chunks
      }
      if (this.strategy === 'drop-oldest' && this.buffer.length >= this.highWaterMark) {
        this.buffer.dequeue(); // Make room
      }
      if (this.strategy === 'strict' && this.buffer.length >= this.highWaterMark) {
        throw new StreamBackpressureError({
          hwm: this.highWaterMark,
          current: this.buffer.length,
          strategy: this.strategy,
        });
      }
      this.buffer.enqueue(chunk);
    }

    // Notify waiters once after all chunks are enqueued
    this.processWaiters();
  }

  end(): void {
    if (this.isEnded) return;
    this.isEnded = true;
    this.processWaiters();
  }

  abort(reason?: unknown): void {
    if (this.isEnded) return;
    this.abortReason = reason ?? new StreamAbortError();
    this.processWaiters();
    // Reject blocked writers
    while (this.writeQueue.length > 0) {
      const writer = this.writeQueue.dequeue();
      // Unblock them so they can re-check state and reject
      writer?.resolve();
    }
  }

  // Generate the AsyncIterable stream
  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<Uint8Array[]>> => {
        return new Promise((resolve, reject) => {
          if (this.buffer.length > 0) {
            const batch = this.buffer.drain();
            resolve({ value: batch, done: false });
            this.resolveBlockedWriters(); // buffer drained
          } else if (this.isEnded) {
            resolve({ value: undefined, done: true });
          } else if (this.abortReason) {
            reject(this.toError(this.abortReason));
          } else {
            // Wait for data
            this.pullQueue.enqueue({ resolve, reject });
          }
        });
      },
    };
  }
}

export function push(options?: PushOptions): PushResult {
  const controller = new PushStreamController(options);

  return {
    writer: controller,
    readable: controller,
  };
}
