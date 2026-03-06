import { StreamAbortError, StreamBackpressureError } from '../errors.js';
import type { BackpressureStrategy, PushOptions, PushResult, Writer } from '../types.js';
import { Queue } from './queue.js';

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
    this.highWaterMark = options.highWaterMark ?? 1024 * 16; // arbitrary chunks default
    this.strategy = options.backpressure ?? 'strict';
  }

  private encodeString(str: string): Uint8Array {
    return new TextEncoder().encode(str);
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
      } else if (this.abortReason !== null) {
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
          throw new StreamBackpressureError();
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
    if (this.isEnded || this.abortReason) return;

    const data = typeof chunk === 'string' ? this.encodeString(chunk) : chunk;

    if (this.buffer.length >= this.highWaterMark && this.strategy === 'drop-newest') {
      return; // Drop newest (the incoming chunk) by doing nothing
    }

    const wait = this.applyBackpressure();
    if (wait) await wait;

    if (this.isEnded || this.abortReason) return; // double check after async wait

    this.buffer.enqueue(data);
    this.processWaiters();
  }

  async writev(chunks: Uint8Array[]): Promise<void> {
    if (this.isEnded || this.abortReason) return;

    // Simplistic batch write depending on strategy.
    for (const chunk of chunks) {
      await this.write(chunk);
    }
  }

  end(): void {
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
      // Unblock them, perhaps they'll error on completion/next check.
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
          } else if (this.abortReason !== null) {
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
