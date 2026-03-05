import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { fromWeb, push, text, toWeb } from '../dist/index.esm.js';

describe('Adapters', () => {
  it('toWeb and fromWeb roundtrip', async () => {
    const { writer, readable } = push();

    writer.write('hello web streams');
    writer.end();

    const webStream = toWeb(readable);
    assert.ok(webStream instanceof ReadableStream, 'should be Web Stream');

    const backToByteflow = fromWeb(webStream);
    const result = await text(backToByteflow);

    assert.strictEqual(result, 'hello web streams');
  });
});
