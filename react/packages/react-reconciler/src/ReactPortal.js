/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_PORTAL_TYPE, REACT_OPTIMISTIC_KEY} from 'shared/ReactSymbols';
import {checkKeyStringCoercion} from 'shared/CheckStringCoercion';

import type {
  ReactNodeList,
  ReactPortal,
  ReactOptimisticKey,
} from 'shared/ReactTypes';

/**
 * 创建跨容器子树的 Portal 描述记录。
 *
 * key 与普通 ReactElement 一样规范化为字符串或 optimistic sentinel；containerInfo 只由目标 HostConfig
 * 解释。该函数不创建 Fiber，也不立即触碰宿主容器。
 */
export function createPortal(
  children: ReactNodeList,
  containerInfo: any,
  // TODO：明确跨 renderer portal 的 implementation 公共契约。
  implementation: any,
  key: ?string | ReactOptimisticKey = null,
): ReactPortal {
  let resolvedKey;
  if (key == null) {
    resolvedKey = null;
  } else if (key === REACT_OPTIMISTIC_KEY) {
    resolvedKey = REACT_OPTIMISTIC_KEY;
  } else {
    if (__DEV__) {
      checkKeyStringCoercion(key);
    }
    resolvedKey = '' + key;
  }
  return {
    // 全局标记让协调器把该普通对象唯一识别为 Portal，而不是用户 child。
    $$typeof: REACT_PORTAL_TYPE,
    key: resolvedKey,
    children,
    containerInfo,
    implementation,
  };
}
