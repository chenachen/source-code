/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_CONSUMER_TYPE, REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';

import type {ReactContext} from 'shared/ReactTypes';

/**
 * 创建带默认值的 Context 描述对象，供 reconciler 在 Provider/Consumer 间维护值栈。
 *
 * @remarks 两套当前值槽允许主、次 renderer 并存；该函数只建立记录，不负责传播更新。
 */
export function createContext<T>(defaultValue: T): ReactContext<T> {
  // TODO：第二个参数曾是可选 `calculateChangedBits`；评估是否应告警以保留该位置。

  const context: ReactContext<T> = {
    $$typeof: REACT_CONTEXT_TYPE,
    // 为支持多个并发 renderer，将其分成主、次两类。系统只预期最多两类同时存在，
    // 例如 React Native（主）与 Fabric（次），或 React DOM（主）与 React ART（次）；
    // 次 renderer 把当前值存入独立槽，避免相互覆盖。
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
    // 记录同一 renderer 内并行使用此 Context 的线程数，例如并行服务端渲染。
    _threadCount: 0,
    // Provider 指回 context 自身；Consumer 再通过 `_context` 指回它，形成有意的环。
    Provider: null as any,
    Consumer: null as any,
  };

  context.Provider = context;
  context.Consumer = {
    $$typeof: REACT_CONSUMER_TYPE,
    _context: context,
  };
  if (__DEV__) {
    context._currentRenderer = null;
    context._currentRenderer2 = null;
  }

  return context;
}
