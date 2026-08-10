/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持可提升资源的 renderer 可整体重导出本模块，保持 HostConfig 导出形状完整。

/** 不支持资源路径的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support Resources. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 不支持资源时不透明的可提升目标根占位。 */
export type HoistableRoot = mixed;
/** 不支持资源时不透明的资源记录占位。 */
export type Resource = mixed;

/** 声明当前 renderer 不管理 stylesheet/script 等可提升资源。 */
export const supportsResources = false;
/** 判断宿主类型是否可提升为资源的占位。 */
export const isHostHoistableType = shim;
/** 从容器解析资源提升目标的占位。 */
export const getHoistableRoot = shim;
/** 按宿主描述查找或创建资源记录的占位。 */
export const getResource = shim;
/** 增加已挂载资源引用的占位。 */
export const acquireResource = shim;
/** 释放已卸载资源引用的占位。 */
export const releaseResource = shim;
/** 认领服务端已存在可提升节点的占位。 */
export const hydrateHoistable = shim;
/** 把新可提升节点挂到目标根的占位。 */
export const mountHoistable = shim;
/** 从目标根卸载可提升节点的占位。 */
export const unmountHoistable = shim;
/** 创建可提升宿主实例的占位。 */
export const createHoistableInstance = shim;
/** commit 前准备资源顺序与容器状态的占位。 */
export const prepareToCommitHoistables = shim;
/** 判断资源是否可能阻塞当前 commit 的占位。 */
export const mayResourceSuspendCommit = shim;
/** 尽早启动资源加载的占位。 */
export const preloadResource = shim;
/** 为未就绪资源登记 commit 挂起的占位。 */
export const suspendResource = shim;
