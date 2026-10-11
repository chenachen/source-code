/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import getActiveElement from './getActiveElement';

import {getOffsets, setOffsets} from './ReactDOMSelection';
import {ELEMENT_NODE, TEXT_NODE} from './HTMLNodeType';

/** 按 nodeType 判断节点是否为 Text。 */
function isTextNode(node) {
  return node && node.nodeType === TEXT_NODE;
}

/** 判断外节点是否包含内节点，兼容 Text 无 contains 的情况。 */
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

/** 检查节点是否仍属于 ownerDocument.documentElement。 */
function isInDocument(node) {
  return (
    node &&
    node.ownerDocument &&
    containsNode(node.ownerDocument.documentElement, node)
  );
}

/** 通过读取 frame 的 location.href 判断能否继续访问同源 iframe；跨源异常返回 false。 */
function isSameOriginFrame(iframe) {
  try {
    // Safari 可能在读取跨源 contentDocument 时向控制台报错。
    // 这里读取 contentWindow.location.href，让跨源访问以可捕获的 SecurityError 失败。

    return typeof iframe.contentWindow.location.href === 'string';
  } catch (err) {
    return false;
  }
}

/** 从容器所属 window（缺失时用全局 window）开始，逐层进入可访问的同源 iframe。 */
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
 * 提交前保存焦点与选区，提交后在原元素仍位于文档内时恢复；聚焦造成的祖先滚动一并还原。
 */

/**
 * 识别支持 selectionStart/selectionEnd 的 input 类型、textarea 与 contentEditable=true。
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

/** 保存当前聚焦元素，以及支持选区时的 selectionStart/end 或文本偏移。 */
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
 * 焦点已改变且原节点仍在文档中时，恢复其选区与焦点，并还原聚焦前记录的祖先滚动位置。
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
 * 读取 input/textarea 的 selectionStart/end，其他可编辑节点使用 DOM Selection 文本偏移；无选区时回退 0。
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
    // contentEditable 等不提供 selectionStart 的节点使用 DOM Selection。
    selection = getOffsets(input);
  }

  return selection || {start: 0, end: 0};
}

/**
 * 写入 input 的 selectionStart/end，或调用 setOffsets 设置 DOM Selection；聚焦由 restoreSelection 单独完成。
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
