/**
 * sync.ts — Synchronous stream utilities for zero-overhead in-memory pipelines.
 *
 * These functions never create Promises or schedule microtasks, making them
 * ideal for CPU-bound workloads where async machinery adds unnecessary overhead.
 */

// Module-level singleton to avoid per-call allocation
const decoder = new TextDecoder();

/**
 * F4: Creates a synchronous in-memory source from a single `Uint8Array` or an array of chunks.
 *
 * The returned `Iterable<Uint8Array[]>` can be used directly with `pullSync()`, `bytesSync()`, etc.
 *
 * @example
 * const source = fromSync(new Uint8Array([72, 101, 108, 108, 111]));
 * const text = textSync(source); // "Hello"
 */
export function* fromSync(data: Uint8Array | Uint8Array[]): Iterable<Uint8Array[]> {
  if (Array.isArray(data)) {
    if (data.length > 0) yield data;
  } else {
    yield [data];
  }
}

/**
 * F5: Collects all chunks from a synchronous iterable into a single `Uint8Array`.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new Uint8Array([1, 2, 3]));
 * const all = bytesSync(src); // Uint8Array [1, 2, 3]
 */
export function bytesSync(source: Iterable<Uint8Array[]>): Uint8Array {
  const chunks: Uint8Array[] = [];
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

/**
 * F5: Decodes all chunks from a synchronous iterable into a UTF-8 string.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new TextEncoder().encode("hello"));
 * const s = textSync(src); // "hello"
 */
export function textSync(source: Iterable<Uint8Array[]>): string {
  return decoder.decode(bytesSync(source));
}

/**
 * F5: Parses all chunks from a synchronous iterable as JSON.
 * Zero Promise allocations.
 *
 * @example
 * const src = fromSync(new TextEncoder().encode('{"ok":true}'));
 * const obj = jsonSync<{ ok: boolean }>(src); // { ok: true }
 */
export function jsonSync<T = unknown>(source: Iterable<Uint8Array[]>): T {
  return JSON.parse(textSync(source)) as T;
}
