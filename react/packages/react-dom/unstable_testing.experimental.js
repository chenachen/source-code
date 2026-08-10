/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 实验测试入口先镜像客户端根 API，再附加 reconciler 测试选择器能力。
export * from './client.js';

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
