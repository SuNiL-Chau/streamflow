import { StreamCancelledError } from '../errors.js';
import type {
  FunctionTransform,
  ReadableBatchStream,
  StatefulTransform,
  Transform,
} from '../types.js';

export type { Transform, StatefulTransform };
export type SyncTransform = (chunk: Uint8Array) => Uint8Array[];

/** Type guard: checks whether a transform is a StatefulTransform object. */
function isStatefulTransform(t: unknown): t is StatefulTransform {
  return (
    typeof t === 'object' && t !== null && typeof (t as StatefulTransform).transform === 'function'
  );
}

/** Wraps an upstream source through a stateless function transform. */
function applyFunctionTransform(
  upstream: ReadableBatchStream,
  fn: FunctionTransform,
  signal?: AbortSignal,
): ReadableBatchStream {
  return (async function* () {
    for await (const batch of upstream) {
      if (signal?.aborted) throw new StreamCancelledError(signal.reason);
      const nextBatch: Uint8Array[] = [];
      for (const chunk of batch) {
        const result = await fn(chunk);
        nextBatch.push(...result);
      }
      if (nextBatch.length > 0) yield nextBatch;
    }
  })();
}

/** Wraps an upstream source through a stateful generator transform. */
function applyStatefulTransform(
  upstream: ReadableBatchStream,
  t: StatefulTransform,
): ReadableBatchStream {
  return (async function* () {
    try {
      yield* t.transform(upstream);
    } catch (err) {
      t.abort?.(err);
      throw err;
    }
  })();
}

/**
 * Options for the async `pull()` pipeline.
 */
export interface PullOptions {
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
export function pull(source: ReadableBatchStream, ...transforms: Transform[]): ReadableBatchStream;

export function pull(
  source: ReadableBatchStream,
  ...transformsAndMaybeOptions: (Transform | PullOptions)[]
): ReadableBatchStream;

export function pull(
  source: ReadableBatchStream,
  ...args: (Transform | PullOptions)[]
): ReadableBatchStream {
  // Detect optional trailing { signal } options object (duck-typed)
  let signal: AbortSignal | undefined;
  let transforms: Transform[];

  const last = args[args.length - 1];
  if (
    args.length > 0 &&
    last !== null &&
    typeof last === 'object' &&
    !isStatefulTransform(last) &&
    typeof last !== 'function' &&
    'signal' in (last as Record<string, unknown>)
  ) {
    signal = (last as PullOptions).signal;
    transforms = args.slice(0, -1) as Transform[];
  } else {
    transforms = args as Transform[];
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

    // Build the pipeline by chaining each transform as a lazy generator layer
    let current: ReadableBatchStream = source;
    for (const transform of transforms) {
      if (isStatefulTransform(transform)) {
        current = applyStatefulTransform(current, transform);
      } else {
        current = applyFunctionTransform(current, transform as FunctionTransform, signal);
      }
    }

    for await (const batch of current) {
      if (signal?.aborted) throw new StreamCancelledError(signal.reason);
      yield batch;
    }
  })();
}

/**
 * Synchronous pull pipeline for in-memory sources — zero async overhead.
 * Only accepts synchronous function transforms.
 *
 * @example
 * const out = pullSync(fromSync(data), chunkSplit, toUpperBytes);
 * const text = textSync(out);
 */
export function* pullSync(
  source: Iterable<Uint8Array[]>,
  ...transforms: SyncTransform[]
): Iterable<Uint8Array[]> {
  for (const batch of source) {
    let currentBatch: Uint8Array[] = batch;

    for (const transform of transforms) {
      const nextBatch: Uint8Array[] = [];
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
