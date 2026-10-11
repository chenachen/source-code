/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';

/**
 * 读取当前 renderer 注入的 owner 栈；生产环境或无活跃 renderer 时返回 `null`。
 * @returns 当前诊断栈字符串或 null；没有自行创建 Error、记录历史栈或缓存结果。
 * @remarks DEV 只在 getCurrentStack 严格为 null 时返回空结果，读取器的异常直接
 * 传播；函数可用性由渠道入口决定，内部实现的生产分支始终返回 null。
 */
export function captureOwnerStack(): null | string {
  if (__DEV__) {
    const getCurrentStack = ReactSharedInternals.getCurrentStack;
    if (getCurrentStack === null) {
      return null;
    }
    // 此 API 只在需要 owner 栈的上下文调用，因此 renderer 的当前栈正是所需结果。
    return getCurrentStack();
  }

  return null;
}
