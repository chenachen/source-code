/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {TEXT_NODE} from './HTMLNodeType';

/**
 * 沿 firstChild 找到子树最左侧叶节点，供字符偏移遍历从文档顺序的起点开始。
 * 空节点原样返回；叶节点不一定是文本，调用者再检查 nodeType。
 */
function getLeafNode(node: ?(Node | Element)) {
  while (node && node.firstChild) {
    node = node.firstChild;
  }
  return node;
}

/**
 * 寻找文档顺序中的下一棵兄弟子树；当前节点没有兄弟时向祖先逐层寻找。
 * 本函数不接收遍历根边界，直到祖先链耗尽才返回 undefined。
 */
function getSiblingNode(node: ?(Node | Element)) {
  while (node) {
    if (node.nextSibling) {
      return node.nextSibling;
    }
    node = node.parentNode;
  }
}

/**
 * 把拼接文本的字符偏移换成具体 Text 节点及其内部偏移，供选区恢复使用。
 * 遍历只把 Text 的 textContent 长度计入累计值；边界偏移优先落到前一个文本节点末尾。
 * 找不到覆盖 offset 的文本节点时返回 undefined。
 *
 * @param root - 开始按文档顺序寻找文本的节点。
 * @param offset - UTF-16 代码单元偏移，与 DOM Selection 的 offset 单位一致。
 */
function getNodeForCharacterOffset(root: Element, offset: number): ?Object {
  let node = getLeafNode(root);
  let nodeStart = 0;
  let nodeEnd = 0;

  while (node) {
    if (node.nodeType === TEXT_NODE) {
      nodeEnd = nodeStart + node.textContent.length;

      if (nodeStart <= offset && nodeEnd >= offset) {
        return {
          node: node,
          offset: offset - nodeStart,
        };
      }

      nodeStart = nodeEnd;
    }

    node = getLeafNode(getSiblingNode(node));
  }
}

export default getNodeForCharacterOffset;
