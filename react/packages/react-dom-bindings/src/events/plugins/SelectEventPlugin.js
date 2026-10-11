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

import {canUseDOM} from 'shared/ExecutionEnvironment';
import {SyntheticEvent} from '../../events/SyntheticEvent';
import isTextInputElement from '../isTextInputElement';
import shallowEqual from 'shared/shallowEqual';

import {registerTwoPhaseEvent} from '../EventRegistry';
import getActiveElement from '../../client/getActiveElement';
import {getNodeFromInstance} from '../../client/ReactDOMComponentTree';
import {hasSelectionCapabilities} from '../../client/ReactInputSelection';
import {DOCUMENT_NODE} from '../../client/HTMLNodeType';
import {accumulateTwoPhaseListeners} from '../DOMPluginEventSystem';

/** IE 文档模式 11 及以下忽略 selectionchange，改为按键/鼠标时轮询。 */
const skipSelectionChangeEvent =
  canUseDOM && 'documentMode' in document && document.documentMode <= 11;

/** 登记 onSelect 的焦点、鼠标、键盘和 selectionchange 原生依赖。 */
function registerEvents() {
  registerTwoPhaseEvent('onSelect', [
    'focusout',
    'contextmenu',
    'dragend',
    'focusin',
    'keydown',
    'keyup',
    'mousedown',
    'mouseup',
    'selectionchange',
  ]);
}

let activeElement = null;
let activeElementInst = null;
let lastSelection = null;
let mouseDown = false;

/**
 * 返回可唯一表示当前选择区的对象。
 * 
 * 不同节点或浏览器的返回形状不保证一致，但同一节点上的相同选择区产生字段值相同的快照，随后用 shallowEqual 比较。
 */
/** 生成节点当前选择区的值快照，供 shallowEqual 比较。 */
function getSelection(node: any) {
  if ('selectionStart' in node && hasSelectionCapabilities(node)) {
    return {
      start: node.selectionStart,
      end: node.selectionEnd,
    };
  } else {
    const win =
      (node.ownerDocument && node.ownerDocument.defaultView) || window;
    const selection = win.getSelection();
    return {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
    };
  }
}

/**
 * 取得事件目标所属的 document。
 */
/** 从 Window、Document 或普通节点确定所属 document。 */
function getEventTargetDocument(eventTarget: any) {
  return eventTarget.window === eventTarget
    ? eventTarget.document
    : eventTarget.nodeType === DOCUMENT_NODE
      ? eventTarget
      : eventTarget.ownerDocument;
}

/**
 * 轮询选择区并判断它是否发生变化。
 * 
 * @param {object} nativeEvent 触发轮询的原生事件。
 * @param {object} nativeEventTarget 原生事件目标。
 * 选择区变化时把事件写入 dispatchQueue，不通过返回值交付事件。
 */
/** 活动节点仍聚焦且鼠标未拖拽时比较选择快照；变化后记录新快照，创建 select 并把两阶段 listeners 入队。 */
function constructSelectEvent(
  dispatchQueue: DispatchQueue,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
) {
  // 必须确认当前元素正确，且用户没有拖拽
  // 选择区，这与原生 `select` 行为一致。HTML5 中 select
  // 只在 input/textarea 上触发，因此没有聚焦元素时
  // 不进行分发。
  const doc = getEventTargetDocument(nativeEventTarget);

  if (
    mouseDown ||
    activeElement == null ||
    activeElement !== getActiveElement(doc)
  ) {
    return;
  }

  // 仅在选择区确实变化时触发。
  const currentSelection = getSelection(activeElement);
  if (!lastSelection || !shallowEqual(lastSelection, currentSelection)) {
    lastSelection = currentSelection;

    const listeners = accumulateTwoPhaseListeners(
      activeElementInst,
      'onSelect',
    );
    if (listeners.length > 0) {
      const event: ReactSyntheticEvent = new SyntheticEvent(
        'onSelect',
        'select',
        null,
        nativeEvent,
        nativeEventTarget,
      );
      dispatchQueue.push({event, listeners});
      event.target = activeElement;
    }
  }
}

/**
 * 该插件创建跨表单元素统一语义的 `onSelect` 事件。
 * 
 * 支持：
 * - input（见 `isTextInputElement`）
 * - textarea 元素
 * - contentEditable 元素
 * 
 * 与浏览器原生实现的差异：
 * - input 与 contentEditable 都会触发；
 * - 折叠选择区也会触发；
 * - 在用户输入之后触发。
 */
/** 跟踪可选择节点的 focus 与鼠标按下状态，并在适当原生事件中轮询选择变化。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
) {
  const targetNode = targetInst ? getNodeFromInstance(targetInst) : window;

  switch (domEventName) {
    // 跟踪当前获得焦点的输入节点。
    case 'focusin':
      if (
        isTextInputElement(targetNode as any) ||
        targetNode.contentEditable === 'true'
      ) {
        activeElement = targetNode;
        activeElementInst = targetInst;
        lastSelection = null;
      }
      break;
    case 'focusout':
      activeElement = null;
      activeElementInst = null;
      lastSelection = null;
      break;
    // 用户拖拽选择区时不触发事件，这与
    // 原生 select 事件语义一致。
    case 'mousedown':
      mouseDown = true;
      break;
    case 'contextmenu':
    case 'mouseup':
    case 'dragend':
      mouseDown = false;
      constructSelectEvent(dispatchQueue, nativeEvent, nativeEventTarget);
      break;
    // Chrome 和 IE 在选择区变化时会触发非标准事件，
    // 有时未变化也会触发。IE 的事件相对
    // 删除时的 key/input 事件顺序异常，因此丢弃。
    //
    // 兼容不提供可靠 selectionchange 的浏览器，在
    // 每次按键后检查选择区。选择区在 keydown 后、
    // keyup 前变化；为处理长按按键产生多个 keydown
    // 但只有一个 keyup 的情况，也在 keydown 时检查。
    // 出于上述顺序问题，IE 也采用同一策略。
    case 'selectionchange':
      if (skipSelectionChangeEvent) {
        break;
      }
    // 继续落入下一分支。
    case 'keydown':
    case 'keyup':
      constructSelectEvent(dispatchQueue, nativeEvent, nativeEventTarget);
  }
}

export {registerEvents, extractEvents};
