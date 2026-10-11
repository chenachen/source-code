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
 * @param defaultValue - 没有对应 Provider 覆盖时读取的值，两个 renderer 槽初始指向同一值。
 * @returns 每次调用新建的 Context 本体，Provider 自引用、Consumer 包装反向引用该本体。
 * @remarks 不拷贝/冻结默认值，也不全局注册名称；Context 身份按对象引用区分，更新比较
 * 和依赖传播由 reconciler 负责。创建时不读取正在渲染的 Hooks dispatcher。
 */
export function createContext<T>(defaultValue: T): ReactContext<T> {
  // TODO：第二个参数曾是可选 `calculateChangedBits`；评估是否应告警以保留该位置。

  const context: ReactContext<T> = {
    $$typeof: REACT_CONTEXT_TYPE,
    // renderer 的 isPrimaryRenderer 选择第一或第二值槽；Provider 入栈保存旧值，出栈恢复。
    // 两类 renderer 可分别维护值；同一槽并非任意多个 renderer 的隔离机制，DEV 会检查冲突。
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
    // 为 Context 协议保留的线程计数字段；本版本的 Context 读写路径不递增它。
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
