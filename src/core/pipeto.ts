import { StreamCancelledError } from '../errors.js';
import type { PipeOptions, ReadableBatchStream, Writer } from '../types.js';

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
export async function pipeTo(
  source: ReadableBatchStream,
  sink: Writer,
  options?: PipeOptions,
): Promise<void> {
  const { signal, preventClose = false, preventAbort = false } = options ?? {};

  // Check before we even start
  if (signal?.aborted) {
    if (!preventAbort) sink.abort(new StreamCancelledError(signal.reason));
    throw new StreamCancelledError(signal.reason);
  }

  // Wire AbortSignal: if the signal fires mid-pipe, record the error
  let signalError: StreamCancelledError | null = null;
  const onAbort = () => {
    signalError = new StreamCancelledError(signal?.reason);
    if (!preventAbort) sink.abort(signalError);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const batch of source) {
      // Check BEFORE delivering to sink
      if (signalError) throw signalError;

      await sink.writev(batch);

      // Check AFTER sink.writev() resolves — signal may have fired during the await
      if (signalError) throw signalError;
    }

    // Source ended normally
    if (!preventClose) {
      sink.end();
    }
  } catch (err) {
    signal?.removeEventListener('abort', onAbort);

    if (!preventAbort && !signalError) {
      // Source errored — propagate abort to sink (only if we didn't already abort via signal)
      sink.abort(err);
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
