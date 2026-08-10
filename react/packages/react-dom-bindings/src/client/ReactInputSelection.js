/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import getActiveElement from './getActiveElement';

import {getOffsets, setOffsets} from './ReactDOMSelection';
import {ELEMENT_NODE, TEXT_NODE} from './HTMLNodeType';

/** `isTextNode` 判断适用条件并返回布尔结果，不写入宿主状态；用于提交前后捕获并恢复焦点与文本选择区。 */
function isTextNode(node) {
  return node && node.nodeType === TEXT_NODE;
}

/** `containsNode` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于提交前后捕获并恢复焦点与文本选择区。 */
function containsNode(outerNode, innerNode) {
  if (!outerNode || !innerNode) {
    return false;
  } else if (outerNode === innerNode) {
    return true;
  } else if (isTextNode(outerNode)) {
    return false;
  } else if (isTextNode(innerNode)) {
    return containsNode(outerNode, innerNode.parentNode);
  } else if ('contains' in outerNode) {
    return outerNode.contains(innerNode);
  } else if (outerNode.compareDocumentPosition) {
    return !!(outerNode.compareDocumentPosition(innerNode) & 16);
  } else {
    return false;
  }
}

/** `isInDocument` 判断适用条件并返回布尔结果，不写入宿主状态；用于提交前后捕获并恢复焦点与文本选择区。 */
function isInDocument(node) {
  return (
    node &&
    node.ownerDocument &&
    containsNode(node.ownerDocument.documentElement, node)
  );
}

/** `isSameOriginFrame` 判断适用条件并返回布尔结果，不写入宿主状态；用于提交前后捕获并恢复焦点与文本选择区。 */
function isSameOriginFrame(iframe) {
  try {
    //访问 HTMLIframeElement 的 contentDocument 可能会导致浏览器
    //抛出，例如，如果它具有跨源 src 属性。
    //当访问导致“已阻止来自某个来源的框架”时，Safari 会在控制台显示错误。例如：
    //iframe.contentDocument.defaultView;
    //一种安全的方式是访问其中一个跨域属性：Window 或 Location
    //这可能会导致“SecurityError”DOM 异常，并且它兼容 Safari。
    //https://html.spec.whatwg.org/multipage/browsers.html#integration-with-idl

    return typeof iframe.contentWindow.location.href === 'string';
  } catch (err) {
    return false;
  }
}

/** `getActiveElementDeep` 查询并返回所需值；缺失或不适用时走显式回退；用于提交前后捕获并恢复焦点与文本选择区。 */
function getActiveElementDeep(containerInfo) {
  let win =
    containerInfo != null &&
    containerInfo.ownerDocument != null &&
    containerInfo.ownerDocument.defaultView != null
      ? containerInfo.ownerDocument.defaultView
      : window;
  let element = getActiveElement(win.document);
  while (element instanceof win.HTMLIFrameElement) {
    if (isSameOriginFrame(element)) {
      win = element.contentWindow;
    } else {
      return element;
    }
    element = getActiveElement(win.document);
  }
  return element;
}

/**
 * @ReactInputSelection：React 输入选择模块。基于 Selection.js，但经过修改以适用于 React，并修复了一些错误（不假设按钮允许范围选择）。React 的输入选择模块。
 */

/**
 * @hasSelectionCapabilities：我们从 https://html.spec.whatwg.org/#do-not-apply, 获取支持选择的元素类型，查看 `selectionStart` 和 `selectionEnd` 行。
 */
export function hasSelectionCapabilities(elem) {
  const nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();
  return (
    nodeName &&
    ((nodeName === 'input' &&
      (elem.type === 'text' ||
        elem.type === 'search' ||
        elem.type === 'tel' ||
        elem.type === 'url' ||
        elem.type === 'password')) ||
      nodeName === 'textarea' ||
      elem.contentEditable === 'true')
  );
}

/** `getSelectionInformation` 查询并返回所需值；缺失或不适用时走显式回退；用于提交前后捕获并恢复焦点与文本选择区。 */
export function getSelectionInformation(containerInfo) {
  const focusedElem = getActiveElementDeep(containerInfo);
  return {
    focusedElem: focusedElem,
    selectionRange: hasSelectionCapabilities(focusedElem)
      ? getSelection(focusedElem)
      : null,
  };
}

/**
 * @restoreSelection：如果任何选区信息可能丢失，请恢复它。当执行可能移除 DOM 节点并再放回去的操作时，这非常有用，因为这些操作会导致焦点丢失。
 */
export function restoreSelection(priorSelectionInformation, containerInfo) {
  const curFocusedElem = getActiveElementDeep(containerInfo);
  const priorFocusedElem = priorSelectionInformation.focusedElem;
  const priorSelectionRange = priorSelectionInformation.selectionRange;
  if (curFocusedElem !== priorFocusedElem && isInDocument(priorFocusedElem)) {
    if (
      priorSelectionRange !== null &&
      hasSelectionCapabilities(priorFocusedElem)
    ) {
      setSelection(priorFocusedElem, priorSelectionRange);
    }

    //聚焦一个节点可能会改变滚动位置，这是不希望发生的
    const ancestors = [];
    let ancestor = priorFocusedElem;
    while ((ancestor = ancestor.parentNode)) {
      if (ancestor.nodeType === ELEMENT_NODE) {
        ancestors.push({
          element: ancestor,
          left: ancestor.scrollLeft,
          top: ancestor.scrollTop,
        });
      }
    }

    if (typeof priorFocusedElem.focus === 'function') {
      priorFocusedElem.focus();
    }

    for (let i = 0; i < ancestors.length; i++) {
      const info = ancestors[i];
      info.element.scrollLeft = info.left;
      info.element.scrollTop = info.top;
    }
  }
}

/**
 * @getSelection: 获取聚焦的 textarea、输入框或 contentEditable 节点的选区范围。
 * -@input: 查找此输入框的选区范围
 * -@return {start: selectionStart, end: selectionEnd}
 */
export function getSelection(input) {
  let selection;

  if ('selectionStart' in input) {
    //带有输入框或文本区域的现代浏览器。
    selection = {
      start: input.selectionStart,
      end: input.selectionEnd,
    };
  } else {
    //可编辑内容或旧版 IE 文本区域。
    selection = getOffsets(input);
  }

  return selection || {start: 0, end: 0};
}

/**
 * @setSelection：设置文本区域或输入框的选区范围并聚焦输入框。
 * -@input     设置此输入框或文本区域的选区范围
 * -@offsets   与 get* 返回的对象形式相同的对象
 */
export function setSelection(input, offsets) {
  const start = offsets.start;
  let end = offsets.end;
  if (end === undefined) {
    end = start;
  }

  if ('selectionStart' in input) {
    input.selectionStart = start;
    input.selectionEnd = Math.min(end, input.value.length);
  } else {
    setOffsets(input, offsets);
  }
}
