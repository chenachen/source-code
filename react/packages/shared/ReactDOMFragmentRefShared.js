/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * DOM 与 Fabric HostConfig 共享的 Fragment Ref 位置比较逻辑。
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';

import {getNextSiblingInstanceOrTextInstanceFiber} from 'react-reconciler/src/ReactFiberTreeReflection';

/**
 * 为没有宿主 children 的 Fragment 推导相对 `otherNode` 的 document position。
 *
 * @remarks 空 Fragment 没有可直接比较的节点，只能先比较 parent，再借下一个宿主 sibling
 * 判断前后；结果始终附加 `IMPLEMENTATION_SPECIFIC`，明确它是推导位置。
 * otherNode 就是宿主父节点时使用 CONTAINS；同父范围内若没有后续宿主 sibling，Fragment
 * 处于父范围末尾。跨父或断开文档的情况沿用父节点比较结果，而不凭 Fiber 顺序制造 DOM 关系。
 * @param fragmentFiber - 要定位的空 Fragment，供树反射查找其后续宿主 sibling。
 * @param parentHostInstance - 实际宿主父实例，不是任意 return Fiber 的 stateNode。
 * @param getPublicInstance - 把宿主 Fiber 转为当前 renderer 可比较的公开实例，兼容 DOM 与 Fabric。
 * @returns document-position 位集；IMPLEMENTATION_SPECIFIC 标记该结果为虚拟位置推导。
 */
export function compareDocumentPositionForEmptyFragment<TPublicInstance>(
  fragmentFiber: Fiber,
  parentHostInstance: TPublicInstance,
  otherNode: TPublicInstance,
  getPublicInstance: (fiber: Fiber) => TPublicInstance,
): number {
  let result;
  // Fragment 无 children 时，用 parent 和相邻宿主 Fiber 推导虚拟位置。
  // $FlowFixMe[incompatible-use] Fabric PublicInstance is opaque
  // $FlowFixMe[prop-missing]
  const parentResult = parentHostInstance.compareDocumentPosition(otherNode);
  result = parentResult;
  if (parentHostInstance === otherNode) {
    result = Node.DOCUMENT_POSITION_CONTAINS;
  } else {
    if (parentResult & Node.DOCUMENT_POSITION_CONTAINED_BY) {
      // otherNode 位于同一 parent 内；比较 Fragment 的下一个宿主 sibling，判断虚拟位置
      // 在它之前还是之后。
      const nextSiblingFiber =
        getNextSiblingInstanceOrTextInstanceFiber(fragmentFiber);
      if (nextSiblingFiber === null) {
        result = Node.DOCUMENT_POSITION_PRECEDING;
      } else {
        const nextSiblingInstance = getPublicInstance(nextSiblingFiber);
        const nextSiblingResult =
          // $FlowFixMe[incompatible-use] Fabric PublicInstance is opaque
          // $FlowFixMe[prop-missing]
          nextSiblingInstance.compareDocumentPosition(otherNode);
        if (
          nextSiblingResult === 0 ||
          nextSiblingResult & Node.DOCUMENT_POSITION_FOLLOWING
        ) {
          result = Node.DOCUMENT_POSITION_FOLLOWING;
        } else {
          result = Node.DOCUMENT_POSITION_PRECEDING;
        }
      }
    }
  }

  result |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
  return result;
}
