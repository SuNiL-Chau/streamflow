export * from './types.js';
export { push } from './core/push.js';
export {
  pull,
  pullSync,
  type Transform,
  type StatefulTransform,
  type SyncTransform,
} from './core/pull.js';
export { share, type SharedStream } from './core/share.js';
export { text, bytes, json } from './core/helpers.js';
export { fromSync, bytesSync, textSync, jsonSync } from './core/sync.js';
export { pipeTo } from './core/pipeto.js';
export * from './errors.js';
export { fromWeb, toWeb } from './adapters/web.js';
export { fromNode, toNode } from './adapters/node.js';
export { use, type StreamPlugin, type StreamContext } from './core/plugin.js';

/*
  Namespace Export Strategy:
  Instead of default exporting an object, we follow standard ESM library design.
  Consumers can use:
  
  import * as Stream from 'byteflow';
  
  Or:
  
  import { push, pull, pipeTo, fromSync, bytesSync } from 'byteflow';
*/
