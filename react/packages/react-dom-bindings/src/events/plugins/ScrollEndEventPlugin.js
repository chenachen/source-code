/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {AnyNativeEvent} from '../PluginModuleType';
import type {DOMEventName} from '../DOMEventNames';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {ReactSyntheticEvent} from '../ReactSyntheticEventType';

import {registerTwoPhaseEvent} from '../EventRegistry';
import {SyntheticUIEvent} from '../SyntheticEvent';

import {canUseDOM} from 'shared/ExecutionEnvironment';
import isEventSupported from '../isEventSupported';

import {IS_CAPTURE_PHASE} from '../EventSystemFlags';

import {batchedUpdates} from '../ReactDOMUpdateBatching';
import {
  processDispatchQueue,
  accumulateSinglePhaseListeners,
  accumulateTwoPhaseListeners,
} from '../DOMPluginEventSystem';

import {
  getScrollEndTimer,
  setScrollEndTimer,
  clearScrollEndTimer,
} from '../../client/ReactDOMComponentTree';

import {enableScrollEndPolyfill} from 'shared/ReactFeatureFlags';

/** 特性开启且 DOM 探测支持原生 scrollend 时为 true。 */
const isScrollEndEventSupported =
  enableScrollEndPolyfill && canUseDOM && isEventSupported('scrollend');

/** 模块级按下状态跨目标共享；任一活动触摸会让结束计时器继续等待 touchend/cancel。 */
let isTouchStarted = false;
/** 鼠标按住时即便短暂停止位移，也不把当前滚动视作结束。 */
let isMouseDown = false;

/** 登记 onScrollEnd 及滚动、触摸、鼠标按下/抬起的检测依赖。 */
function registerEvents() {
  registerTwoPhaseEvent('onScrollEnd', [
    'scroll',
    'scrollend',
    'touchstart',
    'touchcancel',
    'touchend',
    'mousedown',
    'mouseup',
  ]);
}

/** 计时器结束后创建 scrollend 合成事件，在 batch 中执行两阶段列表；此回退路径包含祖先 bubble。 */
function manualDispatchScrollEndEvent(
  inst: Fiber,
  nativeEvent: AnyNativeEvent,
  target: EventTarget,
) {
  const dispatchQueue: DispatchQueue = [];
  const listeners = accumulateTwoPhaseListeners(inst, 'onScrollEnd');
  if (listeners.length > 0) {
    const event: ReactSyntheticEvent = new SyntheticUIEvent(
      'onScrollEnd',
      'scrollend',
      null,
      nativeEvent, // 这里保存触发本轮检测的“scroll”事件。
      target,
    );
    dispatchQueue.push({event, listeners});
  }
  batchedUpdates(runEventInBatch, dispatchQueue);
}

/** 执行 polyfill 累积的 scrollend 队列。 */
function runEventInBatch(dispatchQueue: DispatchQueue) {
  processDispatchQueue(dispatchQueue, 0);
}

/** 清空目标计时器记录；仍在鼠标/触摸按下期间则重新计时，否则派发 scrollend。 */
function fireScrollEnd(
  targetInst: Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: EventTarget,
): void {
  clearScrollEndTimer(nativeEventTarget);
  if (isMouseDown || isTouchStarted) {
    // 若鼠标或触摸仍按下，稍后重试；此时可能仍处于
    // 活动滚动，只是当前暂时没有位移。
    debounceScrollEnd(targetInst, nativeEvent, nativeEventTarget);
    return;
  }
  manualDispatchScrollEndEvent(targetInst, nativeEvent, nativeEventTarget);
}

// 滚动减速后，新 scroll 事件的频率可能很低。
// 该超时时间足以覆盖低频阶段，同时又不会
// 让 scrollend 触发得过晚。
/** 最近 scroll 后等待 200 毫秒再判定结束；按住鼠标或触摸时重复等待。 */
const DEBOUNCE_TIMEOUT = 200;

/** 取消目标旧计时器；有 target Fiber 时保存新的 200 毫秒结束检测。 */
function debounceScrollEnd(
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: EventTarget,
) {
  const existingTimer = getScrollEndTimer(nativeEventTarget);
  if (existingTimer != null) {
    clearTimeout(existingTimer);
  }
  if (targetInst !== null) {
    const newTimer = setTimeout(
      fireScrollEnd.bind(null, targetInst, nativeEvent, nativeEventTarget),
      DEBOUNCE_TIMEOUT,
    );
    setScrollEndTimer(nativeEventTarget, newTimer);
  }
}

/**
 * 原生 scrollend 不可用时，该插件创建 `onScrollEnd` polyfill。
 */
/**
 * 特性开启后，原生支持缺失时仅在 capture 更新按下状态并按目标重置 200ms 计时器。
 * 收到 scrollend 时取消尚存的回退计时器；探测不支持且已经没有计时器则忽略，避免
 * 回退先触发后再次派发。此原生事件路径收集整个 capture 祖先链，但 bubble 仅取
 * target；计时器的 manualDispatchScrollEndEvent 使用另一条两阶段祖先传播路径。
 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: null | EventTarget,
) {
  if (!enableScrollEndPolyfill) {
    return;
  }

  const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;

  if (domEventName !== 'scrollend') {
    if (!isScrollEndEventSupported && inCapturePhase) {
      switch (domEventName) {
        case 'scroll': {
          if (nativeEventTarget !== null) {
            debounceScrollEnd(targetInst, nativeEvent, nativeEventTarget);
          }
          break;
        }
        case 'touchstart': {
          isTouchStarted = true;
          break;
        }
        case 'touchcancel':
        case 'touchend': {
          // 这里不能依赖 pointer 事件，因为原生滚动取得控制权后
          // pointer 会被取消。
          isTouchStarted = false;
          break;
        }
        case 'mousedown': {
          isMouseDown = true;
          break;
        }
        case 'mouseup': {
          isMouseDown = false;
          break;
        }
      }
    }
    return;
  }

  if (!isScrollEndEventSupported && nativeEventTarget !== null) {
    const existingTimer = getScrollEndTimer(nativeEventTarget);
    if (existingTimer != null) {
      // 若收到原生 scrollend，则取消 polyfill 计时。
      // 特性探测失效，或其他
      // polyfill 先通过 dispatchEvent 触发事件时可能出现这种情况。
      clearTimeout(existingTimer);
      clearScrollEndTimer(nativeEventTarget);
    } else {
      // 若此前没有收到 'scroll'，则忽略 scrollend，避免
      // 重复触发，例如本 polyfill 已触发 onScrollEnd，随后
      // 又观察到原生 scrollend。
      return;
    }
  }

  // 原生 scrollend 的 React bubble 路径只处理 target；计时器回退在另一个入口收集两阶段。
  const accumulateTargetOnly = !inCapturePhase;

  const listeners = accumulateSinglePhaseListeners(
    targetInst,
    'onScrollEnd',
    'scrollend',
    inCapturePhase,
    accumulateTargetOnly,
    nativeEvent,
  );

  if (listeners.length > 0) {
    // 刻意延迟到存在 listener 时再创建事件。
    const event: ReactSyntheticEvent = new SyntheticUIEvent(
      'onScrollEnd',
      'scrollend',
      null,
      nativeEvent,
      nativeEventTarget,
    );
    dispatchQueue.push({event, listeners});
  }
}

export {registerEvents, extractEvents};
