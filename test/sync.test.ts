import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { bytesSync, fromSync, jsonSync, pullSync, textSync } from '../dist/index.esm.js';

describe('fromSync / sync helpers', () => {
  it('fromSync wraps a single Uint8Array as a one-batch iterable', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const batches = [...fromSync(data)];
    assert.strictEqual(batches.length, 1);
    assert.strictEqual(batches[0].length, 1);
    assert.deepStrictEqual(batches[0][0], data);
  });

  it('fromSync wraps an array of Uint8Arrays as a one-batch iterable', () => {
    const chunks = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    const batches = [...fromSync(chunks)];
    assert.strictEqual(batches.length, 1);
    assert.strictEqual(batches[0].length, 3);
  });

  it('fromSync yields nothing for empty array', () => {
    const batches = [...fromSync([])];
    assert.strictEqual(batches.length, 0);
  });

  it('bytesSync collects all chunks into a single Uint8Array', () => {
    const enc = new TextEncoder();
    const source = fromSync([enc.encode('foo'), enc.encode('bar')]);
    const result = bytesSync(source);
    assert.ok(result instanceof Uint8Array);
    assert.strictEqual(new TextDecoder().decode(result), 'foobar');
  });

  it('bytesSync works with single chunk', () => {
    const source = fromSync(new Uint8Array([1, 2, 3]));
    const result = bytesSync(source);
    assert.deepStrictEqual(result, new Uint8Array([1, 2, 3]));
  });

  it('textSync decodes bytes to a UTF-8 string', () => {
    const source = fromSync(new TextEncoder().encode('Hello, 世界'));
    const result = textSync(source);
    assert.strictEqual(result, 'Hello, 世界');
  });

  it('jsonSync parses JSON from bytes', () => {
    const payload = JSON.stringify({ ok: true, value: 42 });
    const source = fromSync(new TextEncoder().encode(payload));
    const result = jsonSync(source);
    assert.deepStrictEqual(result, { ok: true, value: 42 });
  });

  it('jsonSync with generic type inference', () => {
    const source = fromSync(new TextEncoder().encode('"hello"'));
    const result = jsonSync(source);
    assert.strictEqual(result, 'hello');
  });

  it('textSync on empty source returns empty string', () => {
    const source = fromSync([]);
    const result = textSync(source);
    assert.strictEqual(result, '');
  });

  it('pullSync + fromSync + bytesSync form a zero-async full pipeline', () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const source = fromSync(input);

    // Simple transform: double each byte
    const doubled = pullSync(source, (chunk) => {
      const out = new Uint8Array(chunk.length * 2);
      for (let i = 0; i < chunk.length; i++) {
        out[i * 2] = chunk[i];
        out[i * 2 + 1] = chunk[i];
      }
      return [out];
    });

    const result = bytesSync(doubled);
    assert.deepStrictEqual(result, new Uint8Array([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]));
  });

  it('pullSync early exit when transform drops all chunks', () => {
    const source = fromSync([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]);
    // Transform returns empty array (drops everything)
    const dropped = pullSync(source, () => []);
    const batches = [...dropped];
    assert.strictEqual(batches.length, 0);
  });
});
