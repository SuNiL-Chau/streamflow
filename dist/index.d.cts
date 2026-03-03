interface Writer {
    write(chunk: Uint8Array | string): void | Promise<void>;
    writev(chunks: Uint8Array[]): void | Promise<void>;
    end(): void;
    abort(reason?: unknown): void;
}
type BackpressureStrategy = 'strict' | 'block' | 'drop-oldest' | 'drop-newest';
interface PushOptions {
    highWaterMark?: number;
    backpressure?: BackpressureStrategy;
}
type ReadableBatchStream = AsyncIterable<Uint8Array[]>;
interface PushResult {
    writer: Writer;
    readable: ReadableBatchStream;
}

declare function push(options?: PushOptions): PushResult;

type Transform = (chunk: Uint8Array) => Uint8Array[] | Promise<Uint8Array[]>;
type SyncTransform = (chunk: Uint8Array) => Uint8Array[];
declare function pull(source: ReadableBatchStream, ...transforms: Transform[]): ReadableBatchStream;
declare function pullSync(source: Iterable<Uint8Array[]>, ...transforms: SyncTransform[]): Iterable<Uint8Array[]>;

interface SharedStream {
    pull(...transforms: Transform[]): ReadableBatchStream;
}
declare function share(source: ReadableBatchStream, options?: PushOptions): SharedStream;

declare function bytes(source: ReadableBatchStream): Promise<Uint8Array>;
declare function text(source: ReadableBatchStream): Promise<string>;
declare function json<T = unknown>(source: ReadableBatchStream): Promise<T>;

declare class StreamError extends Error {
    constructor(message: string);
}
declare class StreamBackpressureError extends StreamError {
    constructor(message?: string);
}
declare class StreamClosedError extends StreamError {
    constructor(message?: string);
}
declare class StreamAbortError extends StreamError {
    constructor(message?: string);
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
 * Registers and applies a Streamflow plugin.
 *
 * @param plugin The plugin object conforming to StreamPlugin
 * @param options Optional configuration for the plugin
 * @returns The result of the plugin's apply function
 */
declare function use<TOptions, TResult>(plugin: StreamPlugin<TOptions, TResult>, options?: TOptions): TResult;

export { type BackpressureStrategy, type PushOptions, type PushResult, type ReadableBatchStream, type SharedStream, StreamAbortError, StreamBackpressureError, StreamClosedError, type StreamContext, StreamError, type StreamPlugin, type SyncTransform, type Transform, type Writer, bytes, fromNode, fromWeb, json, pull, pullSync, push, share, text, toNode, toWeb, use };
