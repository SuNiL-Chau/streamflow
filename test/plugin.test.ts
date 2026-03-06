import assert from 'node:assert';
import test from 'node:test';
import { type StreamContext, type StreamPlugin, type push, text, use } from '../dist/index.esm.js';

test('Plugin Architecture - use() injects correctly', async () => {
  // Define a simple plugin that adds a 'log' wrapper over context
  interface LogResult {
    history: string[];
    myPush: typeof push;
  }

  const testPlugin: StreamPlugin<{ prefix: string }, LogResult> = {
    name: 'test-logger',
    version: '1.0.0',
    apply: (ctx: StreamContext, options?: { prefix: string }): LogResult => {
      const prefix = options?.prefix ?? '[LOG]';
      const history: string[] = [];

      return {
        history,
        myPush: (opts) => {
          history.push(`${prefix} push created`);
          return ctx.push(opts);
        },
      };
    },
  };

  const pluginOutput = use(testPlugin, { prefix: '[TEST]' });

  assert.strictEqual(pluginOutput.history.length, 0);

  // Act
  const { writer, readable } = pluginOutput.myPush();
  writer.write('hello');
  writer.end();

  const outputText = await text(readable);

  // Assert
  assert.strictEqual(outputText, 'hello');
  assert.deepStrictEqual(pluginOutput.history, ['[TEST] push created']);
});
