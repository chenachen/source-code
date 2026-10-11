/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {TEXT_NODE} from '../client/HTMLNodeType';

/**
 * 处理各浏览器 DOM API 差异并取得原生事件目标节点。
 * 
 * @param {object} nativeEvent 原生浏览器事件。
 * @return {DOMEventTarget} 目标节点。
 */
/** 取得原生 target，兼容 srcElement、SVG use，并把文本节点目标归一化到父节点。 */
function getEventTarget(nativeEvent) {
  // IE9 回退使用 nativeEvent.srcElement。
  // 参考：https://github.com/facebook/react/issues/12506
  let target = nativeEvent.target || nativeEvent.srcElement || window;

  // 归一化 SVG <use> 元素事件，见 #4963。
  if (target.correspondingUseElement) {
    target = target.correspondingUseElement;
  }

  // Safari 可能把事件派发到文本节点，Node.TEXT_NODE 的值为 3。
  // @see http://www.quirksmode.org/js/events_properties.html
  return target.nodeType === TEXT_NODE ? target.parentNode : target;
}

export default getEventTarget;
