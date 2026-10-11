/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

/** 某一逻辑栈当前可见值；所有 cursor 共享下面的全局 push/pop 存储。 */
export type StackCursor<T> = {
  /** 当前 Fiber 子树读取到的栈顶值。 */
  current: T
};

/** 每次 push 前保存对应 cursor 的旧值；不同逻辑 cursor 按调用顺序交错存放。 */
const valueStack: Array<any> = [];

/** 开发构建中记录每个栈槽由哪个 Fiber 压入，用于发现不配对 pop。 */
let fiberStack: Array<Fiber | null>;

if (__DEV__) {
  fiberStack = [];
}

/** valueStack 当前栈顶下标；-1 表示空栈。 */
let index = -1;

/** 创建具有默认当前值的逻辑栈 cursor。 */
function createCursor<T>(defaultValue: T): StackCursor<T> {
  return {
    current: defaultValue,
  };
}

/**
 * 恢复 cursor 在对应 push 前的值并释放栈槽。
 *
 * 空栈时报告错误并返回；开发构建还校验 LIFO Fiber 身份，失配时警告后仍弹出当前槽。
 */
function pop<T>(cursor: StackCursor<T>, fiber: Fiber): void {
  if (index < 0) {
    if (__DEV__) {
      console.error('Unexpected pop.');
    }
    return;
  }

  if (__DEV__) {
    if (fiber !== fiberStack[index]) {
      console.error('Unexpected Fiber popped.');
    }
  }

  cursor.current = valueStack[index];

  valueStack[index] = null;

  if (__DEV__) {
    fiberStack[index] = null;
  }

  index--;
}

/** 保存 cursor 旧值并让新值在当前 Fiber 子树内可见。 */
function push<T>(cursor: StackCursor<T>, value: T, fiber: Fiber): void {
  index++;

  valueStack[index] = cursor.current;

  if (__DEV__) {
    fiberStack[index] = fiber;
  }

  cursor.current = value;
}
export {createCursor, pop, push};
