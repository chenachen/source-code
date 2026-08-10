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

/** isScrollEndEventSupported 保存在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const isScrollEndEventSupported =
  enableScrollEndPolyfill && canUseDOM && isEventSupported('scrollend');

let isTouchStarted = false;
let isMouseDown = false;

/** registerEvents 管理在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
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

/** manualDispatchScrollEndEvent 执行在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
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

/** runEventInBatch 执行在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function runEventInBatch(dispatchQueue: DispatchQueue) {
  processDispatchQueue(dispatchQueue, 0);
}

/** fireScrollEnd 执行在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
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
/** DEBOUNCE_TIMEOUT 是在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态使用的稳定常量，避免在热路径重复分配或推导。 */
const DEBOUNCE_TIMEOUT = 200;

/** debounceScrollEnd 执行在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
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
/** extractEvents 从原生事件和 Fiber 路径收集在缺少原生 scrollend 时用 debounce timer 合成结束事件并管理目标状态所需数据；只生成满足插件条件的 listener/event。 */
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

  // React 中 onScrollEnd 不冒泡。
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
