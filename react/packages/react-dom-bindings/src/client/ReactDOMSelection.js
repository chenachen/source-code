/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import getNodeForCharacterOffset from './getNodeForCharacterOffset';
import {TEXT_NODE} from './HTMLNodeType';

/**
 * @param {DOMElement} outerNode 选择区所属的外层 DOM 节点。
 * @return {?object} 以字符偏移表示的起止位置；无选择区时为 null。
 */
export function getOffsets(outerNode) {
  const {ownerDocument} = outerNode;
  const win = (ownerDocument && ownerDocument.defaultView) || window;
  const selection = win.getSelection && win.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const {anchorNode, anchorOffset, focusNode, focusOffset} = selection;

  //在 Firefox 中，anchorNode 和 focusNode 可能是“匿名 div”，例如
  //在 <input type="number"> 上的上/下按钮。匿名 div 似乎不能
  //暴露属性，如果其中任何一个触发“权限被拒绝错误”
  //属性被访问。唯一看似可能避免出错的方法
  //是访问通常适用于非匿名 div 的属性并
  //捕获可能会出现的任何错误。参见
  //https://bugzilla.mozilla.org/show_bug.cgi?id=208427
  try {
    /* eslint-disable ft-flow/no-unused-expressions */
    anchorNode.nodeType;
    focusNode.nodeType;
    /* eslint-enable ft-flow/no-unused-expressions */
  } catch (e) {
    return null;
  }

  return getModernOffsetsFromPoints(
    outerNode,
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset,
  );
}

/**
 * 返回 {start, end}，其中 `start` 是 (anchorNode, anchorOffset) 在 `outerNode` 的 textContent 中的字符/代码点索引，
 * 并且 `end` 是 (focusNode, focusOffset) 的索引。
 *
 * 如果传入无效输入则返回 null，但我们可能应该直接崩溃。
 *
 * 仅导出用于测试。
 */
export function getModernOffsetsFromPoints(
  outerNode,
  anchorNode,
  anchorOffset,
  focusNode,
  focusOffset,
) {
  let length = 0;
  let start = -1;
  let end = -1;
  let indexWithinAnchor = 0;
  let indexWithinFocus = 0;
  let node = outerNode;
  let parentNode = null;

  outer: while (true) {
    let next = null;

    while (true) {
      if (
        node === anchorNode &&
        (anchorOffset === 0 || node.nodeType === TEXT_NODE)
      ) {
        start = length + anchorOffset;
      }
      if (
        node === focusNode &&
        (focusOffset === 0 || node.nodeType === TEXT_NODE)
      ) {
        end = length + focusOffset;
      }

      if (node.nodeType === TEXT_NODE) {
        length += node.nodeValue.length;
      }

      if ((next = node.firstChild) === null) {
        break;
      }
      //从 `node` 移动到它的第一个子元素 `next`。
      parentNode = node;
      node = next;
    }

    while (true) {
      if (node === outerNode) {
        //如果 `outerNode` 有子元素，这总是第二次访问
        //它。如果它没有子节点，这仍然是第一次循环，并且是唯一的
        //有效的选择是 anchorNode 和 focusNode 都等于此节点
        //并且两个偏移量都是0，在这种情况下，我们将如上所述处理。
        break outer;
      }
      if (parentNode === anchorNode && ++indexWithinAnchor === anchorOffset) {
        start = length;
      }
      if (parentNode === focusNode && ++indexWithinFocus === focusOffset) {
        end = length;
      }
      if ((next = node.nextSibling) !== null) {
        break;
      }
      node = parentNode;
      parentNode = node.parentNode;
    }

    //从 `node` 移动到它的下一个同级 `next`。
    node = next;
  }

  if (start === -1 || end === -1) {
    //这永远不应该发生。（如果锚点/焦点节点没有……就会发生）
    //实际上在传入的节点内部。)
    return null;
  }

  return {
    start: start,
    end: end,
  };
}

/**
 * 在现代非 IE 浏览器中，我们可以支持前向和后向选区。
 *
 * 注意：IE10 及以上版本支持 Selection 对象，但它不支持 `extend` 方法，这意味着即使在现代 IE 中，也无法以编程方式创建后向选区。因此，对于所有 IE 版本，我们使用旧的 IE API 来创建选区。
 *
 * @param {DOMElement|DOMTextNode} node
 * @param {object} offsets
 */
export function setOffsets(node, offsets) {
  const doc = node.ownerDocument || document;
  const win = (doc && doc.defaultView) || window;

  //在某些情况下，Edge 会出现“预期对象”失败。
  //例如：列表组件中的 TinyMCE 编辑器支持通过粘贴追加条目时，
  //粘贴 100 多项会触发该失败。
  if (!win.getSelection) {
    return;
  }

  const selection = win.getSelection();
  const length = node.textContent.length;
  let start = Math.min(offsets.start, length);
  let end = offsets.end === undefined ? start : Math.min(offsets.end, length);

  //IE 11 使用现代选择，但不支持 extend 方法。
  //向后翻转选区，这样我们可以用单个范围进行设置。
  if (!selection.extend && start > end) {
    const temp = end;
    end = start;
    start = temp;
  }

  const startMarker = getNodeForCharacterOffset(node, start);
  const endMarker = getNodeForCharacterOffset(node, end);

  if (startMarker && endMarker) {
    if (
      selection.rangeCount === 1 &&
      selection.anchorNode === startMarker.node &&
      selection.anchorOffset === startMarker.offset &&
      selection.focusNode === endMarker.node &&
      selection.focusOffset === endMarker.offset
    ) {
      return;
    }
    const range = doc.createRange();
    range.setStart(startMarker.node, startMarker.offset);
    selection.removeAllRanges();

    if (start > end) {
      selection.addRange(range);
      selection.extend(endMarker.node, endMarker.offset);
    } else {
      range.setEnd(endMarker.node, endMarker.offset);
      selection.addRange(range);
    }
  }
}
