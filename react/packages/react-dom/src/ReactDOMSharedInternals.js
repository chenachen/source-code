/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {EventPriority} from 'react-reconciler/src/ReactEventPriorities';
import type {HostDispatcher} from './shared/ReactDOMTypes';

import noop from 'shared/noop';

/**
 * 无事件上下文时的更新优先级。数值必须与 reconciler 的 `NoEventPriority` 对齐；同构入口不能
 * 直接依赖 renderer 实现，因此在此复制协议值。
 */
export const NoEventPriority: EventPriority = 0 as any;

/** ReactDOM 公共入口与具体 DOM renderer 之间共享的可变协议槽。 */
type ReactDOMInternals = {
  /** 当前宿主 dispatcher，负责冲刷、表单重置与资源提示。 */
  d /* ReactDOMCurrentDispatcher */: HostDispatcher,
  /** 当前 DOM 更新优先级；事件边界进入/退出时成对恢复。 */
  p /* currentUpdatePriority */: EventPriority,
  /** 由客户端 renderer 注入的实例到宿主节点查询器。 */
  findDOMNode:
    | null
    | ((componentOrElement: component(...props: any)) => null | Element | Text),
};

/**
 * renderer 尚未安装时的表单重置失败占位。
 * 只有 React 管理的 form 才能由 dispatcher 处理，裸调用应给出稳定诊断。
 */
function requestFormReset(element: HTMLFormElement) {
  throw new Error(
    'Invalid form element. requestFormReset must be passed a form that was ' +
      'rendered by React.',
  );
}

/** 同构加载阶段的默认 dispatcher：资源与 flush 槽为空，表单重置抛错；客户端 renderer 安装时替换这些槽。 */
const DefaultDispatcher: HostDispatcher = {
  f /* flushSyncWork */: noop,
  r /* requestFormReset */: requestFormReset,
  D /* prefetchDNS */: noop,
  C /* preconnect */: noop,
  L /* preload */: noop,
  m /* preloadModule */: noop,
  X /* preinitScript */: noop,
  S /* preinitStyle */: noop,
  M /* preinitModuleScript */: noop,
};

/** 单例 ReactDOM 共享状态，所有公共子路径通过同一对象与 renderer 协作。 */
const Internals: ReactDOMInternals = {
  d /* ReactDOMCurrentDispatcher */: DefaultDispatcher,
  p /* currentUpdatePriority */: NoEventPriority,
  findDOMNode: null,
};

export default Internals;
