/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** Legacy Fizz 写入目标的最小 push/destroy 协议。 */
export interface Destination {
  /** 推送文本块；null 表示流结束，返回值沿用目标背压信号。 */
  push(chunk: string | null): boolean;
  /** 以错误终止目标流。 */
  destroy(error: Error): mixed;
}

/** 已预计算且可重复写出的文本块品牌类型。 */
export opaque type PrecomputedChunk = string;
/** Legacy 服务端流的普通文本块品牌类型。 */
export opaque type Chunk = string;
/** Legacy 配置中的二进制块占位类型；当前实现不支持构造。 */
export opaque type BinaryChunk = string;

/** Legacy 构建同步执行工作回调。 */
export function scheduleWork(callback: () => void) {
  callback();
}

/**
 * Legacy 配置同步执行“微任务”回调，以与其同步工作调度覆盖保持一致。
 * 当前 legacy API 不调用它，保留该行为用于未来一致性。
 */
export function scheduleMicrotask(callback: () => void) {
  callback();
}

/** Legacy push 目标没有额外缓冲层，因此无需刷新。 */
export function flushBuffered(destination: Destination) {}

/** Legacy push 目标无需显式进入写入阶段。 */
export function beginWriting(destination: Destination) {}

/** 写出一个块并忽略背压返回值。 */
export function writeChunk(
  destination: Destination,
  chunk: Chunk | PrecomputedChunk | BinaryChunk,
): void {
  writeChunkAndReturn(destination, chunk);
}

/** 写出一个块，并把目标的背压布尔值返回给 Fizz。 */
export function writeChunkAndReturn(
  destination: Destination,
  chunk: Chunk | PrecomputedChunk | BinaryChunk,
): boolean {
  return destination.push(chunk);
}

/** Legacy push 目标无需显式结束写入批次。 */
export function completeWriting(destination: Destination) {}

/** 通过 push(null) 正常关闭 Legacy 目标。 */
export function close(destination: Destination) {
  destination.push(null);
}

/** 将普通字符串标记为可写 Chunk；运行时零拷贝。 */
export function stringToChunk(content: string): Chunk {
  return content;
}

/** 将普通字符串标记为 PrecomputedChunk；运行时零拷贝。 */
export function stringToPrecomputedChunk(content: string): PrecomputedChunk {
  return content;
}

/** Legacy 字符串目标不支持二进制视图，调用即明确失败。 */
export function typedArrayToBinaryChunk(
  content: $ArrayBufferView,
): BinaryChunk {
  throw new Error('Not implemented.');
}

/** 文本块字节长度优化在 Legacy 配置中不可用。 */
export const byteLengthOfChunk:
  | null
  | ((chunk: Chunk | PrecomputedChunk) => number) = null;

/** Legacy 配置不支持二进制块长度计算。 */
export function byteLengthOfBinaryChunk(chunk: BinaryChunk): number {
  throw new Error('Not implemented.');
}

/** 把渲染错误转交给目标的 destroy 协议。 */
export function closeWithError(destination: Destination, error: mixed): void {
  // $FlowFixMe[incompatible-type]: This is an Error object or the destination accepts other types.
  destination.destroy(error);
}

/** 复用 React Server 的 JavaScript 快速哈希实现。 */
export {createFastHashJS as createFastHash} from 'react-server/src/createFastHashJS';

/** 将 Blob 编码为带 MIME 类型的 base64 data URL。 */
export function readAsDataURL(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then(arrayBuffer => {
    const encoded =
      typeof Buffer === 'function' && typeof Buffer.from === 'function'
        ? Buffer.from(arrayBuffer).toString('base64')
        : btoa(String.fromCharCode.apply(String, new Uint8Array(arrayBuffer)));
    const mimeType = blob.type || 'application/octet-stream';
    return 'data:' + mimeType + ';base64,' + encoded;
  });
}
