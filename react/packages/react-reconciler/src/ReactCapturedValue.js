/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import {getStackByFiberInDevAndProd} from './ReactFiberComponentStack';

/**
 * 按可引用对象缓存第一次捕获结果。
 *
 * 同一个 Error/thenable 被多个边界观察时复用最初 source 与 stack；WeakMap 不延长错误对象生命周期。
 */
const CapturedStacks: WeakMap<any, CapturedValue<any>> = new WeakMap();

/** 把抛出值与 React 组件来源、捕获时组件栈绑定的错误传播记录。 */
export type CapturedValue<+T> = {
  /** 用户实际抛出或由 renderer 生成的值。 */
  +value: T,
  /** 第一次捕获该值的 Fiber；外部 Error 记录可能没有 Fiber 来源。 */
  source: Fiber | null,
  /** 捕获现场的格式化组件栈；生成失败或调用方未提供时为 null。 */
  stack: string | null,
};

/**
 * 在指定 Fiber 处捕获值及组件栈。
 *
 * 对象值按身份缓存，确保同一错误后续传播不把最初现场改写成外层边界；primitive 无法作为 WeakMap key，
 * 每次都创建独立记录。应在值刚抛出后立即调用，避免调用栈继续变化。
 */
export function createCapturedValueAtFiber<T>(
  value: T,
  source: Fiber,
): CapturedValue<T> {
  // 错误值应在抛出后立即进入此函数，才能保留准确组件栈。
  // $FlowFixMe[invalid-compare]
  if (typeof value === 'object' && value !== null) {
    const existing = CapturedStacks.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const captured: CapturedValue<T> = {
      value,
      source,
      stack: getStackByFiberInDevAndProd(source),
    };
    CapturedStacks.set(value, captured);
    return captured;
  } else {
    return {
      value,
      source,
      stack: getStackByFiberInDevAndProd(source),
    };
  }
}

/**
 * 把宿主或已拥有字符串栈的 Error 转成 CapturedValue。
 *
 * source 固定为 null；提供 stack 时同样写入身份缓存，让之后从 Fiber 捕获同一 Error 时复用该来源。
 */
export function createCapturedValueFromError(
  value: Error,
  stack: null | string,
): CapturedValue<Error> {
  const captured: CapturedValue<Error> = {
    value,
    source: null,
    stack: stack,
  };
  if (typeof stack === 'string') {
    CapturedStacks.set(value, captured);
  }
  return captured;
}
