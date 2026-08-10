/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 这些是提供给第三方 renderer 的半公开常量。这里只重导实现 HostConfig 必需的最小集合，
// 不把全部内部 Lane、mode 与 flags 编码变成兼容承诺。

export {
  NoEventPriority,
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  IdleEventPriority,
} from './ReactEventPriorities';
export {ConcurrentRoot, LegacyRoot} from './ReactRootTags';
