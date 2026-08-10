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
 * 给定任意节点，返回第一个没有子节点的叶节点。
 *
 * @param {DOMElement|DOMTextNode} node
 * @return {DOMElement|DOMTextNode}
 */
function getLeafNode(node: ?(Node | Element)) {
  while (node && node.firstChild) {
    node = node.firstChild;
  }
  return node;
}

/**
 * 在容器中获取下一个兄弟节点。如果节点的兄弟节点用尽，这将向上遍历DOM。
 *
 * @param {DOMElement|DOMTextNode} node
 * @return {?DOMElement|DOMTextNode}
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
 * 获取描述包含偏移量处字符的节点的对象。
 *
 * @param {DOMElement|DOMTextNode} root
 * @param {number} offset
 * @return {?object}
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
