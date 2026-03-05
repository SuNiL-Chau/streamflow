# byteflow

> A cross-runtime JavaScript streaming engine — ergonomic, performant, and `AsyncIterable`-first.

byteflow is an enterprise-grade streaming library for Node.js, Browsers, Deno, and Cloudflare Workers. It replaces the complexity of WHATWG `ReadableStream` and Node.js streams with a simple, unified `AsyncIterable<Uint8Array[]>` interface, backed by an O(1) linked-list queue for deterministic memory and throughput.

**Source of idiation - [Cloudflare Blog Better Stream API](https://blog.cloudflare.com/a-better-web-streams-api/)**

## Benchmarks

Benchmarked against the native Web Streams API on 1KB chunks:

| Payload  | byteflow  | Web Streams  | Speedup    |
|----------|-------------|--------------|------------|
| 1 MB     | 2.21ms      | 13.20ms      | **~5.98x** |
| 100 MB   | 49.65ms     | 264.48ms     | **~5.33x** |
| 1 GB     | 301.59ms    | 2224.99ms    | **~7.38x** |
| 10 GB    | 3078.13ms   | 26218.64ms   | **~8.52x** |

---

## Installation

```bash
npm install byteflow
```

---

## Quick Start

```ts
import { push, text } from 'byteflow';

const { writer, readable } = push();

writer.write('Hello, ');
writer.write('byteflow!');
writer.end();

console.log(await text(readable)); // "Hello, byteflow!"
```

---

## Core API

### `push(options?)`

Creates a writable/readable stream pair. The `writer` side accepts data; the `readable` side is an `AsyncIterable<Uint8Array[]>`.

```ts
import { push } from 'byteflow';

const { writer, readable } = push({
  highWaterMark: 1024, // max buffered chunks (default: 16384)
  backpressure: 'strict', // see Backpressure section
});

// Write data
await writer.write('chunk one');
await writer.write(new Uint8Array([1, 2, 3]));

// Batch write
await writer.writev([new Uint8Array([4, 5]), new Uint8Array([6, 7])]);

// Signal end
writer.end();

// Consume
for await (const batch of readable) {
  for (const chunk of batch) {
    console.log(chunk); // Uint8Array
  }
}
```

#### Backpressure Strategies

| Strategy      | Behaviour when buffer is full                        |
|---------------|------------------------------------------------------|
| `strict`      | Throws `StreamBackpressureError` immediately         |
| `block`       | Awaits until the consumer drains the buffer          |
| `drop-oldest` | Silently drops the oldest buffered chunk             |
| `drop-newest` | Silently discards the incoming (newest) chunk        |

```ts
// Strict (default) — throws on overflow
const { writer } = push({ highWaterMark: 2, backpressure: 'strict' });

// Block — writer waits until consumer reads
const { writer } = push({ highWaterMark: 2, backpressure: 'block' });

// Drop-oldest — keeps latest data
const { writer } = push({ highWaterMark: 2, backpressure: 'drop-oldest' });

// Drop-newest — keeps first data, discards overflow
const { writer } = push({ highWaterMark: 2, backpressure: 'drop-newest' });
```

#### Aborting a Stream

```ts
import { push } from 'byteflow';

const { writer, readable } = push();

writer.write('some data');
writer.abort(new Error('Connection lost'));

try {
  for await (const batch of readable) { /* ... */ }
} catch (err) {
  console.error(err.message); // "Connection lost"
}
```

---

### `pull(source, ...transforms)`

Applies one or more async transform functions to a stream. Each transform receives a `Uint8Array` chunk and returns a `Uint8Array[]` (one chunk can become zero, one, or many output chunks).

```ts
import { push, pull, text } from 'byteflow';

const { writer, readable } = push();

writer.write('hello world');
writer.end();

// Uppercase transform
const uppercased = pull(readable, (chunk) => {
  const str = new TextDecoder().decode(chunk).toUpperCase();
  return [new TextEncoder().encode(str)];
});

console.log(await text(uppercased)); // "HELLO WORLD"
```

#### Chaining Multiple Transforms

```ts
import { push, pull, text } from 'byteflow';

const { writer, readable } = push();
writer.write('  hello world  ');
writer.end();

const processed = pull(
  readable,
  // Trim
  (chunk) => [new TextEncoder().encode(new TextDecoder().decode(chunk).trim())],
  // Reverse
  (chunk) => [new TextEncoder().encode(new TextDecoder().decode(chunk).split('').reverse().join(''))],
);

console.log(await text(processed)); // "dlrow olleh"
```

#### Filtering (dropping chunks)

A transform can return `[]` to drop a chunk entirely:

```ts
import { push, pull, text } from 'byteflow';

const { writer, readable } = push();
writer.write('keep this');
writer.write('skip this');
writer.end();

let i = 0;
const filtered = pull(readable, (chunk) => {
  return i++ % 2 === 0 ? [chunk] : []; // keep even-indexed chunks
});

console.log(await text(filtered)); // "keep this"
```

---

### `pullSync(source, ...transforms)`

A fully synchronous version of `pull` for use with synchronous in-memory data sources. Avoids promise/microtask overhead entirely.

```ts
import { pullSync } from 'byteflow';

function* generateChunks() {
  yield [new TextEncoder().encode('chunk1')];
  yield [new TextEncoder().encode('chunk2')];
}

const result = pullSync(
  generateChunks(),
  (chunk) => [new TextEncoder().encode(new TextDecoder().decode(chunk).toUpperCase())],
);

for (const batch of result) {
  for (const chunk of batch) {
    console.log(new TextDecoder().decode(chunk)); // "CHUNK1", "CHUNK2"
  }
}
```

---

### `share(source, options?)`

Broadcasts a single source stream to **multiple independent consumers**. Each consumer gets its own backpressure-controlled queue.

```ts
import { push, share, text } from 'byteflow';

const { writer, readable } = push();

writer.write('shared data');
writer.end();

const shared = share(readable);

// Two independent consumers
const [consumer1, consumer2] = [
  shared.pull(), // consumer with no transforms
  shared.pull((chunk) => [chunk]), // consumer with identity transform
];

const [result1, result2] = await Promise.all([text(consumer1), text(consumer2)]);

console.log(result1); // "shared data"
console.log(result2); // "shared data"
```

#### Multi-consumer with Different Transforms

```ts
import { push, share, text } from 'byteflow';

const { writer, readable } = push();
writer.write('hello');
writer.end();

const shared = share(readable);

const upper = shared.pull((c) => [new TextEncoder().encode(new TextDecoder().decode(c).toUpperCase())]);
const lower = shared.pull((c) => [new TextEncoder().encode(new TextDecoder().decode(c).toLowerCase())]);

console.log(await text(upper)); // "HELLO"
console.log(await text(lower)); // "hello"
```

---

## Helper Functions

### `text(source)`

Collects all chunks from a stream and decodes them as a UTF-8 string.

```ts
import { push, text } from 'byteflow';

const { writer, readable } = push();
writer.write('Hello ');
writer.write('World');
writer.end();

console.log(await text(readable)); // "Hello World"
```

### `bytes(source)`

Collects all chunks and returns a single concatenated `Uint8Array`.

```ts
import { push, bytes } from 'byteflow';

const { writer, readable } = push();
writer.write(new Uint8Array([1, 2, 3]));
writer.write(new Uint8Array([4, 5, 6]));
writer.end();

const result = await bytes(readable);
console.log(result); // Uint8Array [1, 2, 3, 4, 5, 6]
```

### `json<T>(source)`

Collects all chunks, decodes as UTF-8, and parses as JSON.

```ts
import { push, json } from 'byteflow';

const { writer, readable } = push();
writer.write('{"name":"byteflow","fast":true}');
writer.end();

const data = await json<{ name: string; fast: boolean }>(readable);
console.log(data.name); // "byteflow"
console.log(data.fast); // true
```

---

## Adapters

### Web Streams → byteflow: `fromWeb(webStream)`

Convert a WHATWG `ReadableStream` into a byteflow `ReadableBatchStream`.

```ts
import { fromWeb, text } from 'byteflow';

const response = await fetch('https://example.com/data.txt');
const stream = fromWeb(response.body!);

console.log(await text(stream));
```

### byteflow → Web Streams: `toWeb(source)`

Convert a byteflow stream back to a WHATWG `ReadableStream` (e.g. to pass to `new Response()`).

```ts
import { push, toWeb } from 'byteflow';

const { writer, readable } = push();
writer.write('hello from byteflow');
writer.end();

const webStream = toWeb(readable);
const response = new Response(webStream);
console.log(await response.text()); // "hello from byteflow"
```

### Node.js Readable → byteflow: `fromNode(nodeStream)`

Convert a Node.js `Readable` stream into a byteflow stream.

```ts
import { createReadStream } from 'node:fs';
import { fromNode, text } from 'byteflow';

const nodeStream = createReadStream('./README.md');
const stream = fromNode(nodeStream);

console.log(await text(stream));
```

### byteflow → Node.js Readable: `toNode(source)`

Convert a byteflow stream back to a Node.js `Readable`.

```ts
import { createWriteStream } from 'node:fs';
import { push, toNode } from 'byteflow';

const { writer, readable } = push();
writer.write('writing to file via node stream');
writer.end();

const nodeReadable = toNode(readable);
nodeReadable.pipe(createWriteStream('./output.txt'));
```

---

## Plugin API

### `use(plugin, options?)`

The enterprise-grade plugin system lets you extend byteflow's capabilities by registering plugins that wrap or augment the core `push`, `pull`, and `share` operations.

**Defining a plugin:**

```ts
import { use, type StreamPlugin } from 'byteflow';

// A plugin that logs each time push() is called
const loggerPlugin: StreamPlugin<{ prefix: string }, { push: typeof import('byteflow').push }> = {
  name: 'logger',
  version: '1.0.0',
  apply(ctx, options) {
    const prefix = options?.prefix ?? '[LOG]';
    return {
      push(opts) {
        console.log(`${prefix} Stream created`);
        return ctx.push(opts);
      },
    };
  },
};

const { push: loggedPush } = use(loggerPlugin, { prefix: '[MyApp]' });

const { writer, readable } = loggedPush(); // logs: "[MyApp] Stream created"
writer.write('hi');
writer.end();
```

**Building a metrics plugin:**

```ts
import { use, text, type StreamPlugin } from 'byteflow';

interface MetricsResult {
  push: typeof import('byteflow').push;
  getMetrics: () => { streams: number };
}

const metricsPlugin: StreamPlugin<void, MetricsResult> = {
  name: 'metrics',
  version: '1.0.0',
  apply(ctx) {
    let streams = 0;
    return {
      push(opts) {
        streams++;
        return ctx.push(opts);
      },
      getMetrics: () => ({ streams }),
    };
  },
};

const { push: trackedPush, getMetrics } = use(metricsPlugin);

const { writer, readable } = trackedPush();
writer.write('data');
writer.end();
await text(readable);

console.log(getMetrics()); // { streams: 1 }
```

---

## Error Handling

byteflow exports named error classes so you can handle failures precisely.

```ts
import { push, StreamBackpressureError, StreamAbortError } from 'byteflow';

const { writer, readable } = push({ highWaterMark: 1, backpressure: 'strict' });

try {
  writer.write('first chunk');  // OK
  writer.write('second chunk'); // throws StreamBackpressureError
} catch (err) {
  if (err instanceof StreamBackpressureError) {
    console.log('Buffer is full!');
  }
}
```

| Error Class               | When it's thrown                                          |
|---------------------------|-----------------------------------------------------------|
| `StreamError`             | Base class for all byteflow errors                      |
| `StreamBackpressureError` | `strict` backpressure limit exceeded                      |
| `StreamClosedError`       | Writing to a closed stream                                |
| `StreamAbortError`        | Stream was aborted (default reason if none given)         |

---

## TypeScript

byteflow is written in TypeScript and ships full `.d.ts` types.

```ts
import type {
  ReadableBatchStream,   // AsyncIterable<Uint8Array[]>
  Writer,                // { write, writev, end, abort }
  PushOptions,           // { highWaterMark?, backpressure? }
  PushResult,            // { writer: Writer, readable: ReadableBatchStream }
  BackpressureStrategy,  // 'strict' | 'block' | 'drop-oldest' | 'drop-newest'
  StreamPlugin,          // Plugin interface
  StreamContext,         // Context passed to plugins
} from 'byteflow';
```

---

## Full Pipeline Example

```ts
import { createReadStream } from 'node:fs';
import { fromNode, pull, share, text, bytes } from 'byteflow';

// 1. Source: Node.js file stream
const fileStream = fromNode(createReadStream('./data.bin'));

// 2. Share to multiple consumers
const shared = share(fileStream);

// 3. Consumer A: raw bytes
const rawConsumer = shared.pull();

// 4. Consumer B: uppercase text
const textConsumer = shared.pull(
  (chunk) => [new TextEncoder().encode(new TextDecoder().decode(chunk).toUpperCase())],
);

// 5. Consume in parallel
const [rawData, upperText] = await Promise.all([
  bytes(rawConsumer),
  text(textConsumer),
]);

console.log('Raw size:', rawData.byteLength);
console.log('Uppercased:', upperText);
```

---

## Package Info

| Field    | Value                  |
|----------|------------------------|
| License  | MIT                    |
| ESM      | `dist/index.esm.js`    |
| CJS      | `dist/index.cjs.js`    |
| Types    | `dist/index.d.ts`      |
| Runtime  | Node, Browser, Deno, Cloudflare Workers |

---

## Scripts

```bash
npm run build    # Build ESM + CJS + .d.ts
npm run test     # Run all unit & integration tests
npm run lint     # Check with Biome
npm run format   # Auto-format with Biome
```


