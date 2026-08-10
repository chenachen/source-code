/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持宿主 singleton 的 renderer 可整体重导出本模块。

/** 不支持 singleton 时的防御性占位；返回 any 以兼容各 HostConfig 签名。 */
function shim(...args: any): any {
  throw new Error(
    'The current renderer does not support Singletons. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 声明当前 renderer 不复用 html/head/body 等唯一宿主实例。 */
export const supportsSingletons = false;
/** 按类型与 props 解析既有 singleton 实例的占位。 */
export const resolveSingletonInstance = shim;
/** 提交挂载时取得并配置 singleton 的占位。 */
export const acquireSingletonInstance = shim;
/** 提交卸载时释放并恢复 singleton 的占位。 */
export const releaseSingletonInstance = shim;
/** 判断宿主类型是否必须作为 singleton 管理的占位。 */
export const isHostSingletonType = shim;
/** 判断容器是否构成 singleton 查找范围的占位。 */
export const isSingletonScope = shim;
