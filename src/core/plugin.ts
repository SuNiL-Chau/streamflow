import type { PushOptions, PushResult, ReadableBatchStream } from '../types.js';
import { type Transform, pull } from './pull.js';
import { push } from './push.js';
import type { SharedStream } from './share.js';
import { share } from './share.js';

export interface StreamPlugin<TOptions = unknown, TResult = unknown> {
  name: string;
  version: string;
  apply: (streamContext: StreamContext, options?: TOptions) => TResult;
}

/**
 * The Context object passed to a plugin.
 * It provides access to the core stream operations so plugins can observe or wrap them.
 */
export interface StreamContext {
  push: (options?: PushOptions) => PushResult;
  pull: (source: ReadableBatchStream, ...transforms: Transform[]) => ReadableBatchStream;
  share: (source: ReadableBatchStream, options?: PushOptions) => SharedStream;
}

const defaultContext: StreamContext = {
  push,
  pull,
  share,
};

/**
 * Registers and applies a Byteflow plugin.
 *
 * @param plugin The plugin object conforming to StreamPlugin
 * @param options Optional configuration for the plugin
 * @returns The result of the plugin's apply function
 */
export function use<TOptions, TResult>(
  plugin: StreamPlugin<TOptions, TResult>,
  options?: TOptions,
): TResult {
  return plugin.apply(defaultContext, options);
}
