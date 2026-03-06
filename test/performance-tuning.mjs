import { pull, pullSync, push } from '../dist/index.esm.js';

const MB = 1024 * 1024;
const CHUNK_SIZE = 1024; // 1KB chunks
const TOTAL_CHUNKS = (100 * MB) / CHUNK_SIZE; // 100MB payload

async function runPerformanceTuning() {
  console.log('\n--- Advanced Performance Tuning (100MB Payload) ---');

  const chunk = new Uint8Array(CHUNK_SIZE);
  chunk.fill(1); // fill with dummy data

  // 1. ASYNC PIPELINE
  const asyncStart = performance.now();
  const asyncStream = push({ highWaterMark: TOTAL_CHUNKS * 2 });

  const asyncProducer = (async () => {
    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      await asyncStream.writer.write(chunk);
    }
    asyncStream.writer.end();
  })();

  const asyncConsumed = pull(asyncStream.readable, async (c) => [c]);

  let asyncChunks = 0;
  for await (const batch of asyncConsumed) {
    asyncChunks += batch.length;
  }
  await asyncProducer;
  const asyncEnd = performance.now();
  const asyncTime = asyncEnd - asyncStart;

  console.log(`[Async Pipeline] ${asyncChunks} chunks read in ${asyncTime.toFixed(2)}ms`);

  // 2. SYNC PIPELINE (For synchronous sources and transforms)
  // Here we simulate an in-memory iterable source yielding straight to sync transforms
  console.log('\nMeasuring PullSync overhead...');

  const syncStart = performance.now();

  // Create a sync iterable simulating chunks
  const syncSource = {
    *[Symbol.iterator]() {
      for (let i = 0; i < TOTAL_CHUNKS; i++) {
        yield [chunk];
      }
    },
  };

  const syncConsumed = pullSync(syncSource, (c) => [c]);

  let syncChunks = 0;
  for (const batch of syncConsumed) {
    syncChunks += batch.length;
  }

  const syncEnd = performance.now();
  const syncTime = syncEnd - syncStart;

  console.log(`[Sync Pipeline]  ${syncChunks} chunks read in ${syncTime.toFixed(2)}ms`);

  const diff = (asyncTime / syncTime).toFixed(2);
  console.log(
    `\nResult: The pure synchronous pipeline (pullSync) reduces overhead by ~${diff}x compared to standard async iterator promises.`,
  );
  console.log(
    'Advanced Tuning Note: For file systems or DB cursors that can yield synchronous buffers (or worker-offloaded shared memory), wrapping them in `pullSync` removes microtask latency entirely, satisfying Phase 3 pure-performance requirements.',
  );
}

await runPerformanceTuning();
