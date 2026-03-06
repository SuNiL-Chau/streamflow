export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamError';
  }
}

export class StreamBackpressureError extends StreamError {
  readonly hwm: number;
  readonly current: number;
  readonly strategy: string;

  constructor(context?: { hwm: number; current: number; strategy: string }) {
    const msg = context
      ? `Backpressure limit exceeded: buffer has ${context.current}/${context.hwm} chunks (strategy: '${context.strategy}')`
      : 'Backpressure limit exceeded';
    super(msg);
    this.name = 'StreamBackpressureError';
    this.hwm = context?.hwm ?? 0;
    this.current = context?.current ?? 0;
    this.strategy = context?.strategy ?? 'strict';
  }
}

export class StreamClosedError extends StreamError {
  constructor(message = 'Cannot write to a closed stream') {
    super(message);
    this.name = 'StreamClosedError';
  }
}

export class StreamAbortError extends StreamError {
  constructor(message = 'Stream was aborted') {
    super(message);
    this.name = 'StreamAbortError';
  }
}

export class StreamCancelledError extends StreamError {
  readonly reason: unknown;

  constructor(reason?: unknown) {
    const msg =
      reason instanceof Error
        ? `Stream cancelled: ${reason.message}`
        : reason != null
          ? `Stream cancelled: ${String(reason)}`
          : 'Stream was cancelled via AbortSignal';
    super(msg);
    this.name = 'StreamCancelledError';
    this.reason = reason;
  }
}
