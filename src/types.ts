export interface Writer {
  /** How many more chunks can be buffered before backpressure triggers. `null` means the stream is closed/ended. */
  readonly desiredSize: number | null;
  write(chunk: Uint8Array | string): void | Promise<void>;
  writev(chunks: Uint8Array[]): void | Promise<void>;
  end(): void;
  abort(reason?: unknown): void;
}

export type BackpressureStrategy = 'strict' | 'block' | 'drop-oldest' | 'drop-newest';

export interface PushOptions {
  highWaterMark?: number;
  backpressure?: BackpressureStrategy;
  /** An AbortSignal that, when aborted, will abort the stream with the signal's reason. */
  signal?: AbortSignal;
}

export interface PipeOptions {
  /** An AbortSignal that cancels the pipe operation. */
  signal?: AbortSignal;
  /** If true, the sink will not be closed when the source finishes. Default: false. */
  preventClose?: boolean;
  /** If true, the sink will not be aborted if the source errors. Default: false. */
  preventAbort?: boolean;
}

export type ReadableBatchStream = AsyncIterable<Uint8Array[]>;

export interface PushResult {
  writer: Writer;
  readable: ReadableBatchStream;
}

// ------------------------------------------------------------------
// Transform types
// ------------------------------------------------------------------

/** A simple stateless function transform: takes a single chunk, returns transformed chunks. */
export type FunctionTransform = (chunk: Uint8Array) => Uint8Array[] | Promise<Uint8Array[]>;

/** A synchronous stateless function transform. */
export type SyncFunctionTransform = (chunk: Uint8Array) => Uint8Array[];

/**
 * A stateful transform object, backed by an async generator that wraps the full source.
 * The `abort` hook is called when the pipeline is cancelled or errors, allowing cleanup.
 */
export interface StatefulTransform {
  transform(source: ReadableBatchStream): AsyncGenerator<Uint8Array[], void, unknown>;
  abort?(reason?: unknown): void;
}

/** Union of function-style and stateful object-style transforms. */
export type Transform = FunctionTransform | StatefulTransform;

/** Synchronous-only transform (function only; stateful transforms require async). */
export type SyncTransform = SyncFunctionTransform;
