interface Writer {
    /** How many more chunks can be buffered before backpressure triggers. `null` means the stream is closed/ended. */
    readonly desiredSize: number | null;
    write(chunk: Uint8Array | string): void | Promise<void>;
    writev(chunks: Uint8Array[]): void | Promise<void>;
    end(): void;
    abort(reason?: unknown): void;
}
type BackpressureStrategy = 'strict' | 'block' | 'drop-oldest' | 'drop-newest';
interface PushOptions {
    highWaterMark?: number;
    backpressure?: BackpressureStrategy;
    /** An AbortSignal that, when aborted, will abort the stream with the signal's reason. */
    signal?: AbortSignal;
}
interface PipeOptions {
    /** An AbortSignal that cancels the pipe operation. */
    signal?: AbortSignal;
    /** If true, the sink will not be closed when the source finishes. Default: false. */
    preventClose?: boolean;
    /** If true, the sink will not be aborted if the source errors. Default: false. */
    preventAbort?: boolean;
}
type ReadableBatchStream = AsyncIterable<Uint8Array[]>;
interface PushResult {
    writer: Writer;
    readable: ReadableBatchStream;
}
/** A simple stateless function transform: takes a single chunk, returns transformed chunks. */
type FunctionTransform = (chunk: Uint8Array) => Uint8Array[] | Promise<Uint8Array[]>;
/** A synchronous stateless function transform. */
type SyncFunctionTransform = (chunk: Uint8Array) => Uint8Array[];
/**
 * A stateful transform object, backed by an async generator that wraps the full source.
 * The `abort` hook is called when the pipeline is cancelled or errors, allowing cleanup.
 */
interface StatefulTransform {
    transform(source: ReadableBatchStream): AsyncGenerator<Uint8Array[], void, unknown>;
    abort?(reason?: unknown): void;
}
/** Union of function-style and stateful object-style transforms. */
type Transform = FunctionTransform | StatefulTransform;

declare function push(options?: PushOptions): PushResult;

type SyncTransform = (chunk: Uint8Array) => Uint8Array[];
/**
 * Options for the async `pull()` pipeline.
 */
interface PullOptions {
    signal?: AbortSignal;
}
/**
 * Composes a lazy, pull-through async transform pipeline.
 * Transforms execute only when the consumer iterates — nothing runs eagerly.
 *
 * Accepts both stateless function transforms and stateful generator-object transforms.
 *
 * An optional `{ signal }` options object may be passed as the **last** argument
 * to wire an AbortSignal for cancellation.
 *
 * @example
 * for await (const batch of pull(readable, compress, encrypt)) { ... }
 *
 * @example — with AbortSignal
 * const ctrl = new AbortController();
 * for await (const batch of pull(readable, compress, { signal: ctrl.signal })) { ... }
 */
declare function pull(source: ReadableBatchStream, ...transforms: Transform[]): ReadableBatchStream;
declare function pull(source: ReadableBatchStream, ...transformsAndMaybeOptions: (Transform | PullOptions)[]): ReadableBatchStream;
/**
 * Synchronous pull pipeline for in-memory sources — zero async overhead.
 * Only accepts synchronous function transforms.
 *
 * @example
 * const out = pullSync(fromSync(data), chunkSplit, toUpperBytes);
 * const text = textSync(out);
 */
declare function pullSync(source: Iterable<Uint8Array[]>, ...transforms: SyncTransform[]): Iterable<Uint8Array[]>;

interface SharedStream {
    pull(...transforms: Transform[]): ReadableBatchStream;
}
declare function share(source: ReadableBatchStream, options?: PushOptions): SharedStream;

declare function bytes(source: ReadableBatchStream): Promise<Uint8Array>;
declare function text(source: ReadableBatchStream): Promise<string>;
declare function json<T = unknown>(source: ReadableBatchStream): Promise<T>;

/**
 * sync.ts — Synchronous stream utilities for zero-overhead in-memory pipelines.
 *
 * These functions never create Promises or schedule microtasks, making them
 * ideal for CPU-bound workloads where async machinery adds unnecessary overhead.
 */
/**
 * F4: Creates a synchronous in-memory source from a single `Uint8Array` or an array of chunks.
 *
 * The returned `Iterable<Uint8Array[]>` can be used directly with `pullSync()`, `bytesSync()`, etc.
 *
 * @example
 * const source = fromSync(new Uint8Array([72, 101, 108, 108, 111]));
 * const text = textSync(source); // "Hello"
 */
declare function fromSync(data: Uint8Array | Uint8Array[]): Iterable<Uint8Array[]>;
/**
 * F5: Collects all chunks from a synchronous iterable into a single `Uint8Array`.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new Uint8Array([1, 2, 3]));
 * const all = bytesSync(src); // Uint8Array [1, 2, 3]
 */
declare function bytesSync(source: Iterable<Uint8Array[]>): Uint8Array;
/**
 * F5: Decodes all chunks from a synchronous iterable into a UTF-8 string.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new TextEncoder().encode("hello"));
 * const s = textSync(src); // "hello"
 */
declare function textSync(source: Iterable<Uint8Array[]>): string;
/**
 * F5: Parses all chunks from a synchronous iterable as JSON.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new TextEncoder().encode('{"ok":true}'));
 * const obj = jsonSync<{ ok: boolean }>(src); // { ok: true }
 */
declare function jsonSync<T = unknown>(source: Iterable<Uint8Array[]>): T;

/**
 * F2: Pipes all chunks from `source` into `sink`.
 *
 * Handles backpressure, abort signals, and end/abort propagation cleanly.
 *
 * @param source  - Any `ReadableBatchStream` (AsyncIterable<Uint8Array[]>)
 * @param sink    - Any object implementing the `Writer` interface
 * @param options - Optional pipe configuration (signal, preventClose, preventAbort)
 *
 * @example
 * const { writer, readable } = push();
 * const sink = createMyWriter();
 * await pipeTo(readable, sink);
 */
declare function pipeTo(source: ReadableBatchStream, sink: Writer, options?: PipeOptions): Promise<void>;

declare class StreamError extends Error {
    constructor(message: string);
}
declare class StreamBackpressureError extends StreamError {
    readonly hwm: number;
    readonly current: number;
    readonly strategy: string;
    constructor(context?: {
        hwm: number;
        current: number;
        strategy: string;
    });
}
declare class StreamClosedError extends StreamError {
    constructor(message?: string);
}
declare class StreamAbortError extends StreamError {
    constructor(message?: string);
}
declare class StreamCancelledError extends StreamError {
    readonly reason: unknown;
    constructor(reason?: unknown);
}

declare function fromWeb(stream: ReadableStream<Uint8Array>): ReadableBatchStream;
declare function toWeb(source: ReadableBatchStream): ReadableStream<Uint8Array>;

declare function fromNode(stream: NodeJS.ReadableStream): ReadableBatchStream;
declare function toNode(source: ReadableBatchStream): NodeJS.ReadableStream;

interface StreamPlugin<TOptions = unknown, TResult = unknown> {
    name: string;
    version: string;
    apply: (streamContext: StreamContext, options?: TOptions) => TResult;
}
/**
 * The Context object passed to a plugin.
 * It provides access to the core stream operations so plugins can observe or wrap them.
 */
interface StreamContext {
    push: (options?: PushOptions) => PushResult;
    pull: (source: ReadableBatchStream, ...transforms: Transform[]) => ReadableBatchStream;
    share: (source: ReadableBatchStream, options?: PushOptions) => SharedStream;
}
/**
 * Registers and applies a Byteflow plugin.
 *
 * @param plugin The plugin object conforming to StreamPlugin
 * @param options Optional configuration for the plugin
 * @returns The result of the plugin's apply function
 */
declare function use<TOptions, TResult>(plugin: StreamPlugin<TOptions, TResult>, options?: TOptions): TResult;

export { type BackpressureStrategy, type FunctionTransform, type PipeOptions, type PushOptions, type PushResult, type ReadableBatchStream, type SharedStream, type StatefulTransform, StreamAbortError, StreamBackpressureError, StreamCancelledError, StreamClosedError, type StreamContext, StreamError, type StreamPlugin, type SyncFunctionTransform, type SyncTransform, type Transform, type Writer, bytes, bytesSync, fromNode, fromSync, fromWeb, json, jsonSync, pipeTo, pull, pullSync, push, share, text, textSync, toNode, toWeb, use };
