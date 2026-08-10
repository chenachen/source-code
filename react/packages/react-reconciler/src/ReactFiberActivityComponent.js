/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ActivityInstance} from './ReactFiberConfig';
import type {CapturedValue} from './ReactCapturedValue';
import type {Lane} from './ReactFiberLane';
import type {TreeContext} from './ReactFiberTreeContext';

/** 非 null 时表示仍由服务端宿主标记承载、等待 hydration 的 Activity 边界。 */
export type ActivityState = {
  /** HostConfig 识别的服务端 Activity 边界实例。 */
  dehydrated: ActivityInstance,
  /** 服务端生成时的树 id 上下文，用于 hydration 后保持 useId 稳定。 */
  treeContext: null | TreeContext,
  /** 下一次尝试认领该边界的 Lane；dehydrated 默认 Offscreen，普通边界默认 NoLane。 */
  retryLane: Lane,
  /** 认领期间暂存、待边界恢复路径报告的错误。 */
  hydrationErrors: Array<CapturedValue<mixed>> | null,
};
