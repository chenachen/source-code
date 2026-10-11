/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import getNodeForCharacterOffset from './getNodeForCharacterOffset';
import {TEXT_NODE} from './HTMLNodeType';

/**
 * 从元素所属 window 读取 Selection，并把 anchor/focus 转为该元素内的文本偏移。
 * 无 range、端点不可访问或端点不在元素内时返回 null，供提交前选区快照决定是否恢复。
 * start/end 保留 anchor/focus 的方向，因此后向选区可出现 start 大于 end。
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
 * 把 anchor/focus 的 DOM 位置换成 outerNode.textContent 中的 UTF-16 偏移。
 * 文本节点偏移按 nodeValue.length 计数，元素节点偏移按其前面的子节点文本长度累计。
 * 任一端点不在 outerNode 内时返回 null；此入口也导出供测试。
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
    // anchor 或 focus 不在 outerNode 内，无法转换为该容器的偏移。
    return null;
  }

  return {
    start: start,
    end: end,
  };
}

/**
 * 按 UTF-16 文本偏移创建 Selection。支持 extend 时保留前向/后向方向；
 * 缺少 extend 时把后向起止交换，用普通 Range 表示相同选中范围。
 * 上限裁到当前 textContent 长度；找不到对应 Text 节点则不改选区，已有同一选区也不重复写入。
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
