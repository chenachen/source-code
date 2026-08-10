/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from '../events/DOMEventNames';
import type {ReactScopeInstance} from 'shared/ReactTypes';
import type {
  ReactDOMEventHandle,
  ReactDOMEventHandleListener,
} from './ReactDOMEventHandleTypes';

import {allNativeEvents} from '../events/EventRegistry';
import {
  getEventHandlerListeners,
  setEventHandlerListeners,
  doesTargetHaveEventHandle,
  addEventHandleToTarget,
} from './ReactDOMComponentTree';
import {ELEMENT_NODE} from './HTMLNodeType';
import {listenToNativeEventForNonManagedEventTarget} from '../events/DOMPluginEventSystem';

import {
  enableScopeAPI,
  enableCreateEventHandleAPI,
} from 'shared/ReactFeatureFlags';
import typeof {SyntheticEvent} from '../events/SyntheticEvent';

/** `EventHandleOptions` 定义在受控 EventTarget 上创建和管理事件句柄监听器的数据契约；字段共同约束所有权、生命周期与跨模块传递边界。 */
type EventHandleOptions = {
  /** `EventHandleOptions.capture` 表示所属契约跨调用链传递的受限状态；只在所属契约生命周期内有效。 */
  capture?: boolean,
};

/** `isValidEventTarget` 判断适用条件并返回只读结果；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
function isValidEventTarget(target: EventTarget | ReactScopeInstance): boolean {
  return typeof (target as Object).addEventListener === 'function';
}

/** `isReactScope` 判断适用条件并返回只读结果；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
function isReactScope(target: EventTarget | ReactScopeInstance): boolean {
  return typeof (target as Object).getChildContextValues === 'function';
}

/** `createEventHandleListener` 创建调用方所需对象，不转移无关状态所有权；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
function createEventHandleListener(
  type: DOMEventName,
  isCapturePhaseListener: boolean,
  callback: SyntheticEvent => void,
): ReactDOMEventHandleListener {
  return {
    callback,
    capture: isCapturePhaseListener,
    type,
  };
}

/** `registerReactDOMEvent` 完成该模块的宿主边界操作；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
function registerReactDOMEvent(
  target: EventTarget | ReactScopeInstance,
  domEventName: DOMEventName,
  isCapturePhaseListener: boolean,
): void {
  if ((target as any).nodeType === ELEMENT_NODE) {
    //什么都不做。我们已经附加了所有根监听器。
  } else if (enableScopeAPI && isReactScope(target)) {
    //什么也不做。我们已经附加了所有根监听器。
  } else if (isValidEventTarget(target)) {
    const eventTarget = target as any as EventTarget;
    //这些是有效的事件目标，但它们也是
    //非托管的 React 节点。
    listenToNativeEventForNonManagedEventTarget(
      domEventName,
      isCapturePhaseListener,
      eventTarget,
    );
  } else {
    throw new Error(
      'ReactDOM.createEventHandle: setter called on an invalid ' +
        'target. Provide a valid EventTarget or an element managed by React.',
    );
  }
}

/** `createEventHandle` 创建调用方所需对象，不转移无关状态所有权；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
export function createEventHandle(
  type: string,
  options?: EventHandleOptions,
): ReactDOMEventHandle {
  if (enableCreateEventHandleAPI) {
    const domEventName = type as any as DOMEventName;

    //我们无法使用急切的根监听器支持任意本地事件
    //因为贪心策略依赖于事先知道整个列表。
    //如果我们想支持这个，我们就必须添加代码来进行追踪
    //（或搜索）所有门户和根容器，并懒加载添加监听器
    //每当我们看到一个以前未知的事件时就告诉他们。这似乎很多
    //对于我们甚至没有特定使用案例的事情来说，这种复杂性。
    //不幸的是，这个不变性的缺点是*移除*本地
    //已知事件列表中的事件现在已成为重大更改
    //任何依赖于 createEventHandle API 的代码。
    if (!allNativeEvents.has(domEventName)) {
      throw new Error(
        `Cannot call unstable_createEventHandle with "${domEventName}", as it is not an event known to React.`,
      );
    }

    let isCapturePhaseListener = false;
    if (options != null) {
      const optionsCapture = options.capture;
      if (typeof optionsCapture === 'boolean') {
        isCapturePhaseListener = optionsCapture;
      }
    }

    /** `createEventHandle.eventHandle` 完成该模块的宿主边界操作；用于在受控 EventTarget 上创建和管理事件句柄监听器。 */
    const eventHandle: ReactDOMEventHandle = (
      target: EventTarget | ReactScopeInstance,
      callback: SyntheticEvent => void,
    ) => {
      if (typeof callback !== 'function') {
        throw new Error(
          'ReactDOM.createEventHandle: setter called with an invalid ' +
            'callback. The callback must be a function.',
        );
      }

      if (!doesTargetHaveEventHandle(target, eventHandle)) {
        addEventHandleToTarget(target, eventHandle);
        registerReactDOMEvent(target, domEventName, isCapturePhaseListener);
      }
      const listener = createEventHandleListener(
        domEventName,
        isCapturePhaseListener,
        callback,
      );
      let targetListeners = getEventHandlerListeners(target);
      if (targetListeners === null) {
        targetListeners = new Set();
        setEventHandlerListeners(target, targetListeners);
      }
      targetListeners.add(listener);
      return () => {
        (targetListeners as any as Set<ReactDOMEventHandleListener>).delete(
          listener,
        );
      };
    };

    return eventHandle;
  }
  return null as any;
}
