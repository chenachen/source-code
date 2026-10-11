/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableTaint} from 'shared/ReactFeatureFlags';

import getPrototypeOf from 'shared/getPrototypeOf';

import binaryToComparableString from 'shared/binaryToComparableString';

import ReactSharedInternals from './ReactSharedInternalsServer';
/** 服务端共享的四类污染注册表；由 renderer 请求生命周期共同维护。 */
const {
  TaintRegistryObjects,
  TaintRegistryValues,
  TaintRegistryByteLengths,
  TaintRegistryPendingRequests,
} = ReactSharedInternals;

/** 可用作污染生命周期或对象污染键的对象/函数引用品牌。 */
interface Reference {}

/** 所有 TypedArray 视图共享的父构造器，用于一次性覆盖各具体元素类型。 */
const TypedArrayConstructor = getPrototypeOf(Uint32Array.prototype).constructor;

/** 调用方未指定时使用的泄漏诊断消息。 */
const defaultMessage =
  'A tainted value was attempted to be serialized to a Client Component or Action closure. ' +
  'This would leak it to the client.';

/**
 * 生命周期对象被回收后，释放它对原始污染值的全局持有。
 *
 * 在途请求仍可能握有该值，因此先把释放任务复制到每个请求队列并增加计数，再释放当前
 * 生命周期的一份计数；只有没有任何持有者时才删除注册表项。
 * @param entryValue - FinalizationRegistry 保存的原始键；不持有已回收 lifetime 对象。
 * @remarks 每个当前在途请求获得一项延迟清理记录，使 GC 不能在请求尚可能序列化该值
 * 时提前解除 taint；请求最终减去这些计数。二进制长度筛选集合不随单项删除而清空。
 */
function cleanup(entryValue: string | bigint): void {
  const entry = TaintRegistryValues.get(entryValue);
  if (entry !== undefined) {
    TaintRegistryPendingRequests.forEach(function (requestQueue) {
      requestQueue.push(entryValue);
      entry.count++;
    });
    if (entry.count === 1) {
      TaintRegistryValues.delete(entryValue);
    } else {
      entry.count--;
    }
  }
}

/**
 * 监听生命周期对象回收的注册器。若运行时不支持 FinalizationRegistry，则保守地假定对象
 * 与整个 VM 同寿命；例如 VM 本身可能只服务单个请求，届时进程结束自然完成清理。
 */
const finalizationRegistry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(cleanup)
    : null;

/**
 * 把高熵原始值或二进制值标记为不可序列化，并将记录绑定到给定生命周期对象。
 *
 * @param message 泄漏时显示的消息；为空时使用默认安全提示。
 * @param lifetime 持有该值的对象/函数，其回收会触发引用计数清理。
 * @param value 需要全局阻止泄漏的唯一值。
 * @remarks 注册表作用于当前服务端 React 模块实例的所有请求，不是单请求本地状态。
 * 不测量 value 的熵或扫描其他对象内容，只检查允许的输入类型。二进制 view 编码成
 * 当前字节区间的字符串，与相同字符串键共用记录；后续修改 buffer 不改已登记的键。
 * 同一键重复登记增加 count 并保留第一条 message，每次登记都绑定 lifetime 回收通知。
 * FinalizationRegistry 回调时机由 GC 决定，无显式取消；不支持它时记录保留到 VM 结束。
 * 特性关闭、非法 lifetime/value 或字节编码失败会抛错，不注册完整结果。
 */
export function taintUniqueValue(
  message: ?string,
  lifetime: Reference,
  value: string | bigint | $ArrayBufferView,
): void {
  if (!enableTaint) {
    throw new Error('Not implemented.');
  }
  // eslint-disable-next-line react-internal/safe-string-coercion
  message = '' + (message || defaultMessage);
  if (
    // $FlowFixMe[invalid-compare]
    lifetime === null ||
    (typeof lifetime !== 'object' && typeof lifetime !== 'function')
  ) {
    throw new Error(
      'To taint a value, a lifetime must be defined by passing an object that holds ' +
        'the value.',
    );
  }
  let entryValue: string | bigint;
  if (typeof value === 'string' || typeof value === 'bigint') {
    // 字符串与大整数本身即可作为稳定 Map 键，无需转换。
    entryValue = value;
  } else if (
    value instanceof TypedArrayConstructor ||
    value instanceof DataView
  ) {
    // 把字节内容编码为字符串键；Flight 序列化时采用相同编码，才能按内容找到污染记录。
    TaintRegistryByteLengths.add(value.byteLength);
    entryValue = binaryToComparableString(value);
  } else {
    // $FlowFixMe[invalid-compare]
    const kind = value === null ? 'null' : typeof value;
    if (kind === 'object' || kind === 'function') {
      throw new Error(
        'taintUniqueValue cannot taint objects or functions. Try taintObjectReference instead.',
      );
    }
    throw new Error(
      'Cannot taint a ' +
        kind +
        ' because the value is too general and not unique enough to block globally.',
    );
  }
  const existingEntry = TaintRegistryValues.get(entryValue);
  if (existingEntry === undefined) {
    TaintRegistryValues.set(entryValue, {
      message,
      count: 1,
    });
  } else {
    existingEntry.count++;
  }
  if (finalizationRegistry !== null) {
    finalizationRegistry.register(lifetime, entryValue);
  }
}

/**
 * 按对象身份标记不可序列化引用；弱映射不会延长对象生命周期。
 *
 * @param message 泄漏时显示的消息；为空时使用默认安全提示。
 * @param object 需要阻止传给客户端的对象或函数引用。
 * @remarks 只记录该引用身份，不递归 taint 内部字段或同内容副本；同对象再次调用覆盖
 * message。实际拒绝序列化发生在 Flight 消费注册表时，这里不立即遍历/传输对象。
 * WeakMap 与 unique-value 的引用计数表分开，对象 taint 不需要独立 lifetime 参数。
 */
export function taintObjectReference(
  message: ?string,
  object: Reference,
): void {
  if (!enableTaint) {
    throw new Error('Not implemented.');
  }
  // eslint-disable-next-line react-internal/safe-string-coercion
  message = '' + (message || defaultMessage);
  if (typeof object === 'string' || typeof object === 'bigint') {
    throw new Error(
      'Only objects or functions can be passed to taintObjectReference. Try taintUniqueValue instead.',
    );
  }
  if (
    // $FlowFixMe[invalid-compare]
    object === null ||
    (typeof object !== 'object' && typeof object !== 'function')
  ) {
    throw new Error(
      'Only objects or functions can be passed to taintObjectReference.',
    );
  }
  TaintRegistryObjects.set(object, message);
}
