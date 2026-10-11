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

/** 向指定目标订阅合成事件的函数，返回本次回调的取消函数。 */
export type ReactDOMEventHandle = (
  target: EventTarget | ReactScopeInstance,
  callback: (SyntheticEvent) => void,
) => () => void;

/** event handle 在目标集合中保存的一条回调记录。 */
export type ReactDOMEventHandleListener = {
  /** 匹配事件时调用的合成事件回调。 */
  callback: SyntheticEvent => void,
  /** 本条回调是否在捕获阶段执行。 */
  capture: boolean,
  /** 本条回调匹配的原生事件名。 */
  type: DOMEventName,
};
