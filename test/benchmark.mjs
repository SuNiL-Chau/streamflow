import { push, pull } from '../dist/index.esm.js';

const MB = 1024 * 1024;
const CHUNK_SIZE = 1024; // 1KB chunks

async function runTest(payloadMb) {
    const TOTAL_CHUNKS = (payloadMb * MB) / CHUNK_SIZE; // 1KB chunks
    console.log(`\nPayload: ${payloadMb}MB (${TOTAL_CHUNKS} chunks of 1KB)`);

    const chunk = new Uint8Array(CHUNK_SIZE);
    chunk.fill(1); // fill with dummy data

    // 1. Streamflow Test
    const bsStart = performance.now();
    const { writer, readable } = push({ highWaterMark: TOTAL_CHUNKS * 2 });

    // Producer
    const producer = (async () => {
        for (let i = 0; i < TOTAL_CHUNKS; i++) {
            await writer.write(chunk);
        }
        writer.end();
    })();

    // Consumer (transform and read)
    const consumed = pull(readable, (c) => [c]);
    let bsChunks = 0;
    for await (const batch of consumed) {
        bsChunks += batch.length;
    }
    await producer;
    const bsEnd = performance.now();

    console.log(`Streamflow: ${bsChunks} chunks read in ${(bsEnd - bsStart).toFixed(2)}ms`);

    // 2. Web Streams Comparison
    const wsStart = performance.now();
    let remainingChunks = TOTAL_CHUNKS;
    const webStream = new ReadableStream({
        pull(c) {
            if (remainingChunks-- > 0) {
                c.enqueue(chunk);
            } else {
                c.close();
            }
        }
    });

    // Transform Stream
    const transform = new TransformStream({
        transform(chunk, controller) {
            controller.enqueue(chunk);
        }
    });

    const transformedStream = webStream.pipeThrough(transform);
    const reader = transformedStream.getReader();
    let wsChunks = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) wsChunks++;
    }

    const wsEnd = performance.now();

    console.log(`Web Streams:    ${wsChunks} chunks read in ${(wsEnd - wsStart).toFixed(2)}ms`);

    const diff = ((wsEnd - wsStart) / (bsEnd - bsStart)).toFixed(2);
    console.log(`Result: Streamflow is ~${diff}x faster than Web Streams for this payload.`);
}

async function runBenchmark() {
    console.log('--- Streamflow Benchmark ---');
    await runTest(1); // 1MB Test
    await runTest(100); // 100MB Test
    await runTest(1000); // 1000MB Test (1GB)
    await runTest(10000); // 10000MB Test (10GB)
}

runBenchmark().catch(console.error);
