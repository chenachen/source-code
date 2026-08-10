/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {disableCommentsAsDOMContainers} from 'shared/ReactFeatureFlags';

import {
  ELEMENT_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_FRAGMENT_NODE,
} from './HTMLNodeType';

/** `isValidContainer` 判断适用条件并返回布尔结果，不写入宿主状态；用于判断 DOM 节点能否作为 React 根容器。 */
export function isValidContainer(node: any): boolean {
  return !!(
    node &&
    (node.nodeType === ELEMENT_NODE ||
      node.nodeType === DOCUMENT_NODE ||
      node.nodeType === DOCUMENT_FRAGMENT_NODE ||
      (!disableCommentsAsDOMContainers &&
        node.nodeType === COMMENT_NODE &&
        (node as any).nodeValue === ' react-mount-point-unstable '))
  );
}
