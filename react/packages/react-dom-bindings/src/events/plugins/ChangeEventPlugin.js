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

/** 登记 onChange 两阶段名称及 change/input/click/focus 等原生依赖。 */
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

/** 先登记受控恢复目标，再累积两阶段 onChange listeners；有 listener 时创建 change 合成事件。 */
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
/** select 与 file input 使用原生 change 路径。 */
function shouldUseChangeEvent(elem: Instance | TextInstance) {
  const nodeName = elem.nodeName && elem.nodeName.toLowerCase();
  return (
    nodeName === 'select' ||
    (nodeName === 'input' && (elem as any).type === 'file')
  );
}

/** 旧 IE 的 change/propertychange 不冒泡时，手动创建 onChange 队列并在 batch 中执行。 */
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

/** 用 bubble 方向处理已累积好两阶段顺序的 onChange 队列。 */
function runEventInBatch(dispatchQueue: DispatchQueue) {
  processDispatchQueue(dispatchQueue, 0);
}

/** 比较 DOM 与值 tracker，发生变化时更新基线并返回目标 Fiber，否则返回 undefined。 */
function getInstIfValueChanged(targetInst: Object) {
  const targetNode = getNodeFromInstance(targetInst);
  if (updateValueIfChanged(targetNode as any as HTMLInputElement)) {
    return targetInst;
  }
}

/** 原生 change 到达时返回该控件 Fiber。 */
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
/** 记录旧 IE 活动输入控件与 Fiber，并安装 onpropertychange 监听。 */
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
/** 移除旧 IE 活动控件的 onpropertychange 监听并清空活动引用。 */
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
/** 旧 IE 的 value propertychange 确认 tracker 变化后手动派发 onChange。 */
function handlePropertyChange(nativeEvent) {
  if (nativeEvent.propertyName !== 'value') {
    return;
  }
  if (getInstIfValueChanged(activeElementInst)) {
    manualDispatchChangeEvent(nativeEvent);
  }
}

/** focusin 开始跟踪旧 IE 输入；focusout 停止跟踪。 */
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
    // value tracker 的闭包基线，从而忽略程序化变更。
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
/** selectionchange/keydown/keyup 时比较活动输入值，弥补旧 IE 删除文本不触发 input。 */
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
/** checkbox/radio 使用 click 检测 checked 变化。 */
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

/** 原生 click 后仅在 tracker 检测到值变动时返回目标 Fiber。 */
function getTargetInstForClickEvent(
  domEventName: DOMEventName,
  targetInst: null | Fiber,
) {
  if (domEventName === 'click') {
    return getInstIfValueChanged(targetInst);
  }
}

/** 原生 input/change 后仅在 tracker 检测到值变动时返回目标 Fiber。 */
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
/**
 * 按节点类型和环境能力选择 change、input/value tracker、checkbox/radio click 或旧 IE
 * 轮询路径；自定义元素直接接受 change。检测到变化先登记受控值恢复，再收集两阶段
 * onChange；没有变化时仍处理旧 IE focusin/out，以安装或移除 propertychange 监听。
 * 本入口不在 number input blur 时写 defaultValue；输入框属性同步由控件更新代码负责。
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
