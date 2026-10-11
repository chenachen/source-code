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
 * 更新元素的直接文本内容；非空文本且仅有一个 Text 子节点时复用该节点，保留其 DOM 身份。
 * 空文本或多个子节点走 textContent，由浏览器清空或替换整组子节点。
 */
function setTextContent(node: Element, text: string): void {
  if (text) {
    const firstChild = node.firstChild;

    if (
      firstChild &&
      firstChild === node.lastChild &&
      firstChild.nodeType === TEXT_NODE
    ) {
      firstChild.nodeValue = text;
      return;
    }
  }
  node.textContent = text;
}

export default setTextContent;
