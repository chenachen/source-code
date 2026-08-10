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
    // 暂把二进制内容转换为稳定字符串，从而复用原生 Map 哈希。字符串具体形式不重要，
    // 只需登记与查询产生相同结果；此 API 面向高熵唯一值，因此碰撞风险可以忽略。
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
