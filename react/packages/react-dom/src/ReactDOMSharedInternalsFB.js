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

import {NoEventPriority} from 'react-reconciler/src/ReactEventPriorities';

import noop from 'shared/noop';

/** FB 构建扩展的 ReactDOM 共享协议，额外暴露已在 WWW 使用的事件内部能力。 */
type ReactDOMInternals = {
  /** FB 事件系统注入的六元内部函数组。 */
  Events: [any, any, any, any, any, any],
  /** 当前宿主 dispatcher。 */
  d /* ReactDOMCurrentDispatcher */: HostDispatcher,
  /** 当前 DOM 更新优先级。 */
  p /* currentUpdatePriority */: EventPriority,
  /** 由客户端 renderer 注入的实例到宿主节点查询器。 */
  findDOMNode:
    | null
    | ((componentOrElement: component(...props: any)) => null | Element | Text),
};

/** renderer 尚未安装时的无副作用 FB dispatcher。 */
const DefaultDispatcher: HostDispatcher = {
  f /* flushSyncWork */: noop,
  r /* requestFormReset */: noop,
  D /* prefetchDNS */: noop,
  C /* preconnect */: noop,
  L /* preload */: noop,
  m /* preloadModule */: noop,
  X /* preinitScript */: noop,
  S /* preinitStyle */: noop,
  M /* preinitModuleScript */: noop,
};

/** FB ReactDOM 入口共享的单例可变状态。 */
const Internals: ReactDOMInternals = {
  Events: null as any,
  d /* ReactDOMCurrentDispatcher */: DefaultDispatcher,
  p /* currentUpdatePriority */: NoEventPriority,
  findDOMNode: null,
};

export default Internals;
