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

/** event handle 的固定阶段选项。 */
type EventHandleOptions = {
  /** 为 true 时在 capture 阶段调用；默认 false。 */
  capture?: boolean,
};

/** 检查目标是否暴露 addEventListener，供非 React EventTarget 注册。 */
function isValidEventTarget(target: EventTarget | ReactScopeInstance): boolean {
  return typeof (target as Object).addEventListener === 'function';
}

/** 按 getChildContextValues 能力识别 React Scope 实例。 */
function isReactScope(target: EventTarget | ReactScopeInstance): boolean {
  return typeof (target as Object).getChildContextValues === 'function';
}

/** 保存回调、原生事件名和 capture 选项，供派发时筛选。 */
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

/** Element/Scope 复用根 listener；其他有效 EventTarget 安装 non-managed listener，非法目标抛错。 */
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

/** 特性开启时校验事件必须已被 React 注册，返回固定事件名/阶段的订阅函数；关闭时返回 null。 */
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

    /** 为目标登记回调并返回取消函数；取消只移除回调记录，原生 listener 与句柄去重记录保留。 */
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
