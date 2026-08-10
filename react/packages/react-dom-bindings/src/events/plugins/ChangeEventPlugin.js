/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {TextInstance, Instance} from '../../client/ReactFiberConfigDOM';
import type {AnyNativeEvent} from '../PluginModuleType';
import type {DOMEventName} from '../DOMEventNames';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {ReactSyntheticEvent} from '../ReactSyntheticEventType';

import {registerTwoPhaseEvent} from '../EventRegistry';
import {SyntheticEvent} from '../SyntheticEvent';
import isTextInputElement from '../isTextInputElement';
import {canUseDOM} from 'shared/ExecutionEnvironment';

import getEventTarget from '../getEventTarget';
import isEventSupported from '../isEventSupported';
import {getNodeFromInstance} from '../../client/ReactDOMComponentTree';
import {updateValueIfChanged} from '../../client/inputValueTracking';
import {enqueueStateRestore} from '../ReactDOMControlledComponent';

import {batchedUpdates} from '../ReactDOMUpdateBatching';
import {
  processDispatchQueue,
  accumulateTwoPhaseListeners,
} from '../DOMPluginEventSystem';
import isCustomElement from '../../shared/isCustomElement';

/** registerEvents 管理针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
function registerEvents() {
  registerTwoPhaseEvent('onChange', [
    'change',
    'click',
    'focusin',
    'focusout',
    'input',
    'keydown',
    'keyup',
    'selectionchange',
  ]);
}

/** createAndAccumulateChangeEvent 为针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
function createAndAccumulateChangeEvent(
  dispatchQueue: DispatchQueue,
  inst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  target: null | EventTarget,
) {
  // 标记本轮事件循环需要恢复受控状态。
  enqueueStateRestore(target as any as Node);
  const listeners = accumulateTwoPhaseListeners(inst, 'onChange');
  if (listeners.length > 0) {
    const event: ReactSyntheticEvent = new SyntheticEvent(
      'onChange',
      'change',
      null,
      nativeEvent,
      target,
    );
    dispatchQueue.push({event, listeners});
  }
}
/**
 * IE 兼容 shim 使用。
 */
let activeElement = null;
let activeElementInst = null;

/**
 * 处理 `change` 事件。
 */
/** shouldUseChangeEvent 判断针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function shouldUseChangeEvent(elem: Instance | TextInstance) {
  const nodeName = elem.nodeName && elem.nodeName.toLowerCase();
  return (
    nodeName === 'select' ||
    (nodeName === 'input' && (elem as any).type === 'file')
  );
}

/** manualDispatchChangeEvent 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function manualDispatchChangeEvent(nativeEvent: AnyNativeEvent) {
  const dispatchQueue: DispatchQueue = [];
  createAndAccumulateChangeEvent(
    dispatchQueue,
    activeElementInst,
    nativeEvent,
    getEventTarget(nativeEvent),
  );

  // 若 change/propertychange 支持冒泡，本可像其他
  // 事件一样绑定并经过统一 emitter；但它们
  // 不冒泡，因此必须手动监听、入队并
  // 处理抽象 change 事件。
  //
  // 这里必须批处理，确保所有 handler 都在
  // 下一次重渲染前执行，包括挂在祖先
  // 而非 input 自身的 handler。否则受控
  // 组件与事件冒泡无法正确配合，因为
  // 全部 handler 执行前组件就会重渲染并把值恢复，
  // 详见 https://github.com/facebook/react/issues/708。
  batchedUpdates(runEventInBatch, dispatchQueue);
}

/** runEventInBatch 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function runEventInBatch(dispatchQueue: DispatchQueue) {
  processDispatchQueue(dispatchQueue, 0);
}

/** getInstIfValueChanged 查询并返回针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getInstIfValueChanged(targetInst: Object) {
  const targetNode = getNodeFromInstance(targetInst);
  if (updateValueIfChanged(targetNode as any as HTMLInputElement)) {
    return targetInst;
  }
}

/** getTargetInstForChangeEvent 查询并返回针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getTargetInstForChangeEvent(
  domEventName: DOMEventName,
  targetInst: null | Fiber,
) {
  if (domEventName === 'change') {
    return targetInst;
  }
}

/**
 * 处理 `input` 事件。
 */
let isInputEventSupported = false;
if (canUseDOM) {
  // IE9 声称支持 input，但删除文本时不会触发，
  // 因此忽略 IE9 的 input 支持。
  isInputEventSupported =
    isEventSupported('input') &&
    (!document.documentMode || document.documentMode > 9);
}

/**
 * IE9 及更早版本：开始跟踪目标元素的 propertychange，并覆盖 value 属性，
 * 以区分用户输入与 JavaScript 写值。
 */
/** startWatchingForValueChange 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function startWatchingForValueChange(
  target: Instance | TextInstance,
  targetInst: null | Fiber,
) {
  activeElement = target;
  activeElementInst = targetInst;
  (activeElement as any).attachEvent('onpropertychange', handlePropertyChange);
}

/**
 * IE9 及更早版本：移除当前跟踪元素上的监听器。
 */
/** stopWatchingForValueChange 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function stopWatchingForValueChange() {
  if (!activeElement) {
    return;
  }
  (activeElement as any).detachEvent('onpropertychange', handlePropertyChange);
  activeElement = null;
  activeElementInst = null;
}

/**
 * IE9 及更早版本：处理 propertychange；活动元素值变化时发送 `change`。
 */
// $FlowFixMe[missing-local-annot]
/** handlePropertyChange 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function handlePropertyChange(nativeEvent) {
  if (nativeEvent.propertyName !== 'value') {
    return;
  }
  if (getInstIfValueChanged(activeElementInst)) {
    manualDispatchChangeEvent(nativeEvent);
  }
}

/** handleEventsForInputEventPolyfill 执行针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function handleEventsForInputEventPolyfill(
  domEventName: DOMEventName,
  target: Instance | TextInstance,
  targetInst: null | Fiber,
) {
  if (domEventName === 'focusin') {
    // IE9 的 propertychange 覆盖多数输入，但存在缺陷，
    // 删除文本时不触发；selectionchange
    // 恰好覆盖其余情况，因此监听它并在
    // 值变化时转发事件。
    // 无论哪种事件，若值由 JavaScript 修改，都不应调用 handler；
    // 因此重定义 `.value` setter，同步更新
    // activeElementValue，从而忽略程序化变更。
    //
    // stopWatching() 理论上是 noop，但仍调用以防
    // 此前遗漏了 blur。
    stopWatchingForValueChange();
    startWatchingForValueChange(target, targetInst);
  } else if (domEventName === 'focusout') {
    stopWatchingForValueChange();
  }
}

// 仅用于 IE8 与 IE9。
/** getTargetInstForInputEventPolyfill 查询并返回针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getTargetInstForInputEventPolyfill(
  domEventName: DOMEventName,
  targetInst: null | Fiber,
) {
  if (
    domEventName === 'selectionchange' ||
    domEventName === 'keyup' ||
    domEventName === 'keydown'
  ) {
    // selectionchange 的 target 只是 document，无法定位输入元素，
    // 因此改为检查 activeElement。
    //
    // 绝大多数情况下不需要 keydown/keyup。IE8 在脚本设置
    // `value` 后的首次输入不会触发 propertychange，
    // 只触发 keydown/keypress/keyup；监听 keyup 通常
    // 能捕获变化，监听 keydown 则能在用户长按时为第一
    // 次击键补发事件，虽会稍有延迟，发生在
    // 第二次击键前。粘贴等其他输入方式似乎
    // 会正常触发 selectionchange。
    return getInstIfValueChanged(activeElementInst);
  }
}

/**
 * 处理 `click` 事件。
 */
/** shouldUseClickEvent 判断针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function shouldUseClickEvent(elem: any) {
  // 使用 `click` 检测 checkbox/radio 的值变化。
  // 该方案跨浏览器可靠，而 IE8 的 `change` 要到
  // `blur` 时才触发。
  const nodeName = elem.nodeName;
  return (
    nodeName &&
    nodeName.toLowerCase() === 'input' &&
    (elem.type === 'checkbox' || elem.type === 'radio')
  );
}

/** getTargetInstForClickEvent 查询并返回针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getTargetInstForClickEvent(
  domEventName: DOMEventName,
  targetInst: null | Fiber,
) {
  if (domEventName === 'click') {
    return getInstIfValueChanged(targetInst);
  }
}

/** getTargetInstForInputOrChangeEvent 查询并返回针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getTargetInstForInputOrChangeEvent(
  domEventName: DOMEventName,
  targetInst: null | Fiber,
) {
  if (domEventName === 'input' || domEventName === 'change') {
    return getInstIfValueChanged(targetInst);
  }
}

/**
 * 该插件创建跨表单元素统一语义的 `onChange`，在不会产生视觉闪烁的时机触发，
 * 从而允许 handler 修改元素值。
 * 
 * 支持：
 * - input（见 `isTextInputElement`）
 * - textarea 元素
 * - select 元素
 */
/** extractEvents 从原生事件和 Fiber 路径收集针对 input/select/checkbox 等元素选择变更检测策略并合成 onChange所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: null | EventTarget,
) {
  const targetNode = targetInst ? getNodeFromInstance(targetInst) : window;

  let getTargetInstFunc, handleEventFunc;
  if (shouldUseChangeEvent(targetNode)) {
    getTargetInstFunc = getTargetInstForChangeEvent;
  } else if (isTextInputElement(targetNode as any as HTMLElement)) {
    if (isInputEventSupported) {
      getTargetInstFunc = getTargetInstForInputOrChangeEvent;
    } else {
      getTargetInstFunc = getTargetInstForInputEventPolyfill;
      handleEventFunc = handleEventsForInputEventPolyfill;
    }
  } else if (shouldUseClickEvent(targetNode)) {
    getTargetInstFunc = getTargetInstForClickEvent;
  } else if (
    targetInst &&
    isCustomElement(targetInst.elementType, targetInst.memoizedProps)
  ) {
    getTargetInstFunc = getTargetInstForChangeEvent;
  }

  if (getTargetInstFunc) {
    const inst = getTargetInstFunc(domEventName, targetInst);
    if (inst) {
      createAndAccumulateChangeEvent(
        dispatchQueue,
        inst,
        nativeEvent,
        nativeEventTarget,
      );
      return;
    }
  }

  if (handleEventFunc) {
    handleEventFunc(domEventName, targetNode, targetInst);
  }
}

export {registerEvents, extractEvents};
