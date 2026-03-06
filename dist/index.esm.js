import { Readable } from 'stream';

// src/errors.ts
var StreamError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "StreamError";
  }
};
var StreamBackpressureError = class extends StreamError {
  hwm;
  current;
  strategy;
  constructor(context) {
    const msg = context ? `Backpressure limit exceeded: buffer has ${context.current}/${context.hwm} chunks (strategy: '${context.strategy}')` : "Backpressure limit exceeded";
    super(msg);
    this.name = "StreamBackpressureError";
    this.hwm = context?.hwm ?? 0;
    this.current = context?.current ?? 0;
    this.strategy = context?.strategy ?? "strict";
  }
};
var StreamClosedError = class extends StreamError {
  constructor(message = "Cannot write to a closed stream") {
    super(message);
    this.name = "StreamClosedError";
  }
};
var StreamAbortError = class extends StreamError {
  constructor(message = "Stream was aborted") {
    super(message);
    this.name = "StreamAbortError";
  }
};
var StreamCancelledError = class extends StreamError {
  reason;
  constructor(reason) {
    const msg = reason instanceof Error ? `Stream cancelled: ${reason.message}` : reason != null ? `Stream cancelled: ${String(reason)}` : "Stream was cancelled via AbortSignal";
    super(msg);
    this.name = "StreamCancelledError";
    this.reason = reason;
  }
};

// src/core/queue.ts
var Node = class {
  value;
  next = null;
  constructor(value) {
    this.value = value;
  }
};
var Queue = class {
  head = null;
  tail = null;
  _length = 0;
  /**
   * Get the number of items in the queue. O(1).
   */
  get length() {
    return this._length;
  }
  /**
   * Add an item to the end of the queue. O(1).
   */
  enqueue(value) {
    const node = new Node(value);
    if (this.tail) {
      this.tail.next = node;
      this.tail = node;
    } else {
      this.head = node;
      this.tail = node;
    }
    this._length++;
  }
  /**
   * Remove and return the item from the front of the queue. O(1).
   */
  dequeue() {
    if (!this.head) {
      return void 0;
    }
    const value = this.head.value;
    this.head = this.head.next;
    if (!this.head) {
      this.tail = null;
    }
    this._length--;
    return value;
  }
  /**
   * Remove and return the item from the back of the queue (drop-newest). O(n).
   * Since this is a singly linked list, popping the tail requires traversing from the head.
   * Note: This is an acceptable O(n) tradeoff because 'drop-newest' is a backpressure
   * mitigation strategy explicitly chosen to drop data, not the happy-path `dequeue`.
   */
  pop() {
    if (!this.head) return void 0;
    if (this.head === this.tail) {
      const value2 = this.head.value;
      this.head = null;
      this.tail = null;
      this._length = 0;
      return value2;
    }
    let current = this.head;
    while (current.next && current.next !== this.tail) {
      current = current.next;
    }
    const value = this.tail?.value;
    current.next = null;
    this.tail = current;
    this._length--;
    return value;
  }
  /**
   * Extract all remaining items into an array and clear the queue. O(N).
   */
  drain() {
    const result = [];
    let current = this.head;
    while (current) {
      result.push(current.value);
      current = current.next;
    }
    this.head = null;
    this.tail = null;
    this._length = 0;
    return result;
  }
  peek() {
    return this.head?.value;
  }
};

// src/core/push.ts
var encoder = new TextEncoder();
var PushStreamController = class {
  buffer = new Queue();
  highWaterMark;
  strategy;
  isEnded = false;
  abortReason = null;
  pullQueue = new Queue();
  // To handle the 'block' backpressure strategy
  writeQueue = new Queue();
  constructor(options = {}) {
    this.highWaterMark = options.highWaterMark ?? 1024 * 16;
    this.strategy = options.backpressure ?? "strict";
    if (options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        this.abortReason = new StreamCancelledError(signal.reason);
      } else {
        const onAbort = () => {
          this.abort(new StreamCancelledError(signal.reason));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  }
  // F7: desiredSize getter — how much buffer space is left
  get desiredSize() {
    if (this.isEnded || this.abortReason) return null;
    return this.highWaterMark - this.buffer.length;
  }
  toError(reason) {
    return reason instanceof Error ? reason : new StreamAbortError(String(reason));
  }
  processWaiters() {
    if (this.pullQueue.length > 0) {
      if (this.buffer.length > 0) {
        const batch = this.buffer.drain();
        const waiter = this.pullQueue.dequeue();
        waiter?.resolve({ value: batch, done: false });
        this.resolveBlockedWriters();
      } else if (this.isEnded) {
        while (this.pullQueue.length > 0) {
          const waiter = this.pullQueue.dequeue();
          waiter?.resolve({ value: void 0, done: true });
        }
      } else if (this.abortReason) {
        while (this.pullQueue.length > 0) {
          const waiter = this.pullQueue.dequeue();
          waiter?.reject(this.toError(this.abortReason));
        }
      }
    }
  }
  resolveBlockedWriters() {
    while (this.writeQueue.length > 0 && this.buffer.length < this.highWaterMark) {
      const writer = this.writeQueue.dequeue();
      writer?.resolve();
    }
  }
  applyBackpressure() {
    if (this.buffer.length >= this.highWaterMark) {
      switch (this.strategy) {
        case "strict":
          throw new StreamBackpressureError({
            hwm: this.highWaterMark,
            current: this.buffer.length,
            strategy: this.strategy
          });
        case "drop-oldest":
          this.buffer.dequeue();
          break;
        case "drop-newest":
          this.buffer.pop();
          break;
        case "block":
          return new Promise((resolve) => {
            this.writeQueue.enqueue({ resolve });
          });
      }
    }
  }
  async write(chunk) {
    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return;
    const data = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    if (this.buffer.length >= this.highWaterMark && this.strategy === "drop-newest") {
      return;
    }
    const wait = this.applyBackpressure();
    if (wait) await wait;
    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return;
    this.buffer.enqueue(data);
    this.processWaiters();
  }
  // I2 + F8: Atomic writev — enqueue all chunks in one pass before notifying waiters
  async writev(chunks) {
    if (this.isEnded) throw new StreamClosedError();
    if (this.abortReason) return;
    if (chunks.length === 0) return;
    if (this.strategy === "block" && this.buffer.length >= this.highWaterMark) {
      await new Promise((resolve) => {
        this.writeQueue.enqueue({ resolve });
      });
      if (this.isEnded) throw new StreamClosedError();
      if (this.abortReason) return;
    }
    for (const chunk of chunks) {
      if (this.strategy === "drop-newest" && this.buffer.length >= this.highWaterMark) {
        break;
      }
      if (this.strategy === "drop-oldest" && this.buffer.length >= this.highWaterMark) {
        this.buffer.dequeue();
      }
      if (this.strategy === "strict" && this.buffer.length >= this.highWaterMark) {
        throw new StreamBackpressureError({
          hwm: this.highWaterMark,
          current: this.buffer.length,
          strategy: this.strategy
        });
      }
      this.buffer.enqueue(chunk);
    }
    this.processWaiters();
  }
  end() {
    if (this.isEnded) return;
    this.isEnded = true;
    this.processWaiters();
  }
  abort(reason) {
    if (this.isEnded) return;
    this.abortReason = reason ?? new StreamAbortError();
    this.processWaiters();
    while (this.writeQueue.length > 0) {
      const writer = this.writeQueue.dequeue();
      writer?.resolve();
    }
  }
  // Generate the AsyncIterable stream
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        return new Promise((resolve, reject) => {
          if (this.buffer.length > 0) {
            const batch = this.buffer.drain();
            resolve({ value: batch, done: false });
            this.resolveBlockedWriters();
          } else if (this.isEnded) {
            resolve({ value: void 0, done: true });
          } else if (this.abortReason) {
            reject(this.toError(this.abortReason));
          } else {
            this.pullQueue.enqueue({ resolve, reject });
          }
        });
      }
    };
  }
};
function push(options) {
  const controller = new PushStreamController(options);
  return {
    writer: controller,
    readable: controller
  };
}

// src/core/pull.ts
function isStatefulTransform(t) {
  return typeof t === "object" && t !== null && typeof t.transform === "function";
}
function applyFunctionTransform(upstream, fn, signal) {
  return (async function* () {
    for await (const batch of upstream) {
      if (signal?.aborted) throw new StreamCancelledError(signal.reason);
      const nextBatch = [];
      for (const chunk of batch) {
        const result = await fn(chunk);
        nextBatch.push(...result);
      }
      if (nextBatch.length > 0) yield nextBatch;
    }
  })();
}
function applyStatefulTransform(upstream, t) {
  return (async function* () {
    try {
      yield* t.transform(upstream);
    } catch (err) {
      t.abort?.(err);
      throw err;
    }
  })();
}
function pull(source, ...args) {
  let signal;
  let transforms;
  const last = args[args.length - 1];
  if (args.length > 0 && last !== null && typeof last === "object" && !isStatefulTransform(last) && typeof last !== "function" && "signal" in last) {
    signal = last.signal;
    transforms = args.slice(0, -1);
  } else {
    transforms = args;
  }
  return (async function* () {
    if (signal?.aborted) {
      throw new StreamCancelledError(signal.reason);
    }
    if (transforms.length === 0) {
      for await (const batch of source) {
        if (signal?.aborted) throw new StreamCancelledError(signal.reason);
        yield batch;
      }
      return;
    }
    let current = source;
    for (const transform of transforms) {
      if (isStatefulTransform(transform)) {
        current = applyStatefulTransform(current, transform);
      } else {
        current = applyFunctionTransform(current, transform, signal);
      }
    }
    for await (const batch of current) {
      if (signal?.aborted) throw new StreamCancelledError(signal.reason);
      yield batch;
    }
  })();
}
function* pullSync(source, ...transforms) {
  for (const batch of source) {
    let currentBatch = batch;
    for (const transform of transforms) {
      const nextBatch = [];
      for (const chunk of currentBatch) {
        const result = transform(chunk);
        nextBatch.push(...result);
      }
      currentBatch = nextBatch;
      if (currentBatch.length === 0) break;
    }
    if (currentBatch.length > 0) {
      yield currentBatch;
    }
  }
}

// src/core/share.ts
function share(source, options) {
  const consumers = [];
  let isConsuming = false;
  async function consume() {
    isConsuming = true;
    try {
      for await (const batch of source) {
        if (consumers.length === 0) {
          continue;
        }
        await Promise.all(consumers.map((c) => Promise.resolve(c.writer.writev(batch))));
      }
      for (const consumer of consumers) {
        consumer.writer.end();
      }
    } catch (error) {
      for (const consumer of consumers) {
        consumer.writer.abort(error);
      }
    }
  }
  return {
    pull(...transforms) {
      const consumer = push(options);
      consumers.push(consumer);
      if (!isConsuming) {
        consume().catch(console.error);
      }
      if (transforms.length > 0) {
        return pull(consumer.readable, ...transforms);
      }
      return consumer.readable;
    }
  };
}

// src/core/helpers.ts
async function bytes(source) {
  const chunks = [];
  let totalLength = 0;
  for await (const batch of source) {
    for (const chunk of batch) {
      chunks.push(chunk);
      totalLength += chunk.length;
    }
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function text(source) {
  const buffer = await bytes(source);
  return new TextDecoder().decode(buffer);
}
async function json(source) {
  const txt = await text(source);
  return JSON.parse(txt);
}

// src/core/sync.ts
var decoder = new TextDecoder();
function* fromSync(data) {
  if (Array.isArray(data)) {
    if (data.length > 0) yield data;
  } else {
    yield [data];
  }
}
function bytesSync(source) {
  const chunks = [];
  let totalLength = 0;
  for (const batch of source) {
    for (const chunk of batch) {
      chunks.push(chunk);
      totalLength += chunk.length;
    }
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function textSync(source) {
  return decoder.decode(bytesSync(source));
}
function jsonSync(source) {
  return JSON.parse(textSync(source));
}

// src/core/pipeto.ts
async function pipeTo(source, sink, options) {
  const { signal, preventClose = false, preventAbort = false } = options ?? {};
  if (signal?.aborted) {
    if (!preventAbort) sink.abort(new StreamCancelledError(signal.reason));
    throw new StreamCancelledError(signal.reason);
  }
  let signalError = null;
  const onAbort = () => {
    signalError = new StreamCancelledError(signal?.reason);
    if (!preventAbort) sink.abort(signalError);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const batch of source) {
      if (signalError) throw signalError;
      await sink.writev(batch);
      if (signalError) throw signalError;
    }
    if (!preventClose) {
      sink.end();
    }
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    if (!preventAbort && !signalError) {
      sink.abort(err);
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

// src/adapters/web.ts
async function* fromWeb(stream) {
  for await (const chunk of stream) {
    yield [chunk];
  }
}
function toWeb(source) {
  const flatten = async function* () {
    for await (const batch of source) {
      for (const chunk of batch) {
        yield chunk;
      }
    }
  };
  const globalReadableStream = globalThis.ReadableStream;
  if (globalReadableStream && typeof globalReadableStream.from === "function") {
    return globalReadableStream.from(flatten());
  }
  const iterator = flatten()[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else if (value) controller.enqueue(value);
    },
    cancel(reason) {
      if (iterator.throw) iterator.throw(reason).catch(() => {
      });
    }
  });
}
async function* fromNode(stream) {
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) {
      yield [chunk];
    } else if (chunk && typeof chunk.byteLength === "number") {
      yield [new Uint8Array(chunk.buffer || chunk)];
    } else if (typeof chunk === "string") {
      yield [new TextEncoder().encode(chunk)];
    } else {
      throw new TypeError(`Unsupported chunk type in fromNode: ${typeof chunk}`);
    }
  }
}
function toNode(source) {
  return Readable.from(
    (async function* () {
      for await (const batch of source) {
        for (const chunk of batch) {
          yield chunk;
        }
      }
    })()
  );
}

// src/core/plugin.ts
var defaultContext = {
  push,
  pull,
  share
};
function use(plugin, options) {
  return plugin.apply(defaultContext, options);
}

export { StreamAbortError, StreamBackpressureError, StreamCancelledError, StreamClosedError, StreamError, bytes, bytesSync, fromNode, fromSync, fromWeb, json, jsonSync, pipeTo, pull, pullSync, push, share, text, textSync, toNode, toWeb, use };
//# sourceMappingURL=index.esm.js.map
//# sourceMappingURL=index.esm.js.map