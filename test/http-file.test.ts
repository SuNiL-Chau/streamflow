import * as assert from 'node:assert';
import { createReadStream, createWriteStream, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { fromNode, fromWeb, text, toNode } from '../dist/index.esm.js';

describe('Integration Tests: File and HTTP Streaming', () => {
  let server: Server;
  const PORT = 3055;
  const TEST_PAYLOAD = 'hello cross-runtime streams';
  let tempFilePath: string;
  let outFilePath: string;

  before(async () => {
    tempFilePath = join(tmpdir(), 'byteflow-test-in.txt');
    outFilePath = join(tmpdir(), 'byteflow-test-out.txt');
    writeFileSync(tempFilePath, TEST_PAYLOAD);

    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(TEST_PAYLOAD);
    });

    await new Promise<void>((res) => {
      server.listen(PORT, () => res());
    });
  });

  after(async () => {
    try {
      rmSync(tempFilePath, { force: true });
      rmSync(outFilePath, { force: true });
    } catch {}

    await new Promise<void>((res) => {
      server.close(() => res());
    });
  });

  it('HTTP streaming (Node + fetch -> Web Streams Adapter)', async () => {
    // Node 18+ has built in fetch which uses Web Streams
    const response = await fetch(`http://localhost:${PORT}`);
    assert.ok(response.body, 'Expected response boy');

    // fromWeb adapter test
    const bs = fromWeb(response.body as ReadableStream<Uint8Array>);
    const result = await text(bs);

    assert.strictEqual(result, TEST_PAYLOAD);
  });

  it('File streaming (Node FS -> Node Streams Adapter)', async () => {
    const readStream = createReadStream(tempFilePath);
    const bs = fromNode(readStream);

    // Pipe direct to another file via toNode
    const writeStream = createWriteStream(outFilePath);
    const nodeOut = toNode(bs);

    await new Promise<void>((resolve, reject) => {
      nodeOut.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    const written = readFileSync(outFilePath, 'utf8');
    assert.strictEqual(written, TEST_PAYLOAD);
  });
});
