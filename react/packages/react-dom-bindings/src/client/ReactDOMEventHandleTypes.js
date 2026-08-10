/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactScopeInstance} from 'shared/ReactTypes';
import type {DOMEventName} from '../events/DOMEventNames';
import typeof {SyntheticEvent} from '../events/SyntheticEvent';

/** `ReactDOMEventHandle` 定义约束事件句柄目标、监听器和选项的 Flow 契约使用的数据契约；字段共同限定所有权、生命周期与跨模块传递边界。 */
export type ReactDOMEventHandle = (
  target: EventTarget | ReactScopeInstance,
  callback: (SyntheticEvent) => void,
) => () => void;

/** `ReactDOMEventHandleListener` 定义约束事件句柄目标、监听器和选项的 Flow 契约使用的数据契约；字段共同限定所有权、生命周期与跨模块传递边界。 */
export type ReactDOMEventHandleListener = {
  /** `ReactDOMEventHandleListener.callback` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于约束事件句柄目标、监听器和选项的 Flow 契约。 */
  callback: SyntheticEvent => void,
  /** `ReactDOMEventHandleListener.capture` 表示该契约在调用链间传递的受限状态；仅用于约束事件句柄目标、监听器和选项的 Flow 契约。 */
  capture: boolean,
  /** `ReactDOMEventHandleListener.type` 表示区分目标类别或宿主标签的判别值；仅用于约束事件句柄目标、监听器和选项的 Flow 契约。 */
  type: DOMEventName,
};
