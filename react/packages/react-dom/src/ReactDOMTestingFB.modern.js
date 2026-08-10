/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 现代 FB 测试入口镜像产品 API，并附加 reconciler 的 DOM 测试选择器。
export * from './ReactDOMFB.modern';

export {
  createComponentSelector,
  createHasPseudoClassSelector,
  createRoleSelector,
  createTestNameSelector,
  createTextSelector,
  getFindAllNodesFailureDescription,
  findAllNodes,
  findBoundingRects,
  focusWithin,
  observeVisibleRects,
} from 'react-reconciler/src/ReactFiberReconciler';
