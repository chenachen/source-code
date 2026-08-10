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
