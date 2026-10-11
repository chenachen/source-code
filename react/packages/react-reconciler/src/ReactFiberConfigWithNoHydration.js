/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持 hydration 的 renderer 可整体重导出本模块，保持 HostConfig 导出形状完整。

/** 不支持 hydration 时的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support hydration. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 不支持 hydration 时的 Activity 宿主边界占位类型。 */
export type ActivityInstance = mixed;
/** 不支持 hydration 时的 Suspense 宿主边界占位类型。 */
export type SuspenseInstance = mixed;
/** 声明当前 renderer 不能认领服务端已存在的宿主树。 */
export const supportsHydration = false;
/** 判断服务端 Suspense 边界是否仍处于 pending 的占位。 */
export const isSuspenseInstancePending = shim;
/** 判断服务端 Suspense 边界是否已渲染 fallback 的占位。 */
export const isSuspenseInstanceFallback = shim;
/** 读取服务端 Suspense fallback 错误详情的占位。 */
export const getSuspenseInstanceFallbackErrorDetails = shim;
/** 在服务端 Suspense 内容可用时登记 retry 的占位。 */
export const registerSuspenseInstanceRetry = shim;
/** 判断宿主节点能否作为 form state marker 认领的占位。 */
export const canHydrateFormStateMarker = shim;
/** 比较 form state marker 与当前 action 状态是否匹配的占位。 */
export const isFormStateMarkerMatching = shim;
/** 返回同级下一个可认领宿主节点的占位。 */
export const getNextHydratableSibling = shim;
/** 跳过 singleton 后返回下一个可认领 sibling 的占位。 */
export const getNextHydratableSiblingAfterSingleton = shim;
/** 返回普通宿主实例的第一个可认领 child 的占位。 */
export const getFirstHydratableChild = shim;
/** 返回根容器中的第一个可认领 child 的占位。 */
export const getFirstHydratableChildWithinContainer = shim;
/** 返回 Activity 宿主边界内第一个可认领 child 的占位。 */
export const getFirstHydratableChildWithinActivityInstance = shim;
/** 返回 Suspense 宿主边界内第一个可认领 child 的占位。 */
export const getFirstHydratableChildWithinSuspenseInstance = shim;
/** 返回 singleton 范围内第一个可认领 child 的占位。 */
export const getFirstHydratableChildWithinSingleton = shim;
/** 判断既有宿主元素能否匹配当前 HostComponent 的占位。 */
export const canHydrateInstance = shim;
/** 判断既有宿主文本能否匹配当前 HostText 的占位。 */
export const canHydrateTextInstance = shim;
/** 判断既有宿主标记能否匹配当前 Activity 边界的占位。 */
export const canHydrateActivityInstance = shim;
/** 判断既有宿主标记能否匹配当前 Suspense 边界的占位。 */
export const canHydrateSuspenseInstance = shim;
/** 为已认领宿主元素绑定 props 并报告 hydration 是否成功的占位。 */
export const hydrateInstance = shim;
/** 认领宿主文本并判断内容是否需修正的占位。 */
export const hydrateTextInstance = shim;
/** 认领 Activity 宿主边界的占位。 */
export const hydrateActivityInstance = shim;
/** 认领 Suspense 宿主边界的占位。 */
export const hydrateSuspenseInstance = shim;
/** 返回整个 Activity 边界之后的下一个可认领实例占位。 */
export const getNextHydratableInstanceAfterActivityInstance = shim;
/** 返回整个 Suspense 边界之后的下一个可认领实例占位。 */
export const getNextHydratableInstanceAfterSuspenseInstance = shim;
/** 完成父实例 children hydration 并判断是否需 commit 更新的占位。 */
export const finalizeHydratedChildren = shim;
/** commit 已认领普通宿主实例后续工作的占位。 */
export const commitHydratedInstance = shim;
/** commit 根容器 hydration 后续工作的占位。 */
export const commitHydratedContainer = shim;
/** commit Activity 边界 hydration 后续工作的占位。 */
export const commitHydratedActivityInstance = shim;
/** commit Suspense 边界 hydration 后续工作的占位。 */
export const commitHydratedSuspenseInstance = shim;
/** hydration commit 后集中派发宿主延迟事件的占位。 */
export const flushHydrationEvents = shim;
/** 删除未能认领的 Activity 边界内容的占位。 */
export const clearActivityBoundary = shim;
/** 删除未能认领的 Suspense 边界内容的占位。 */
export const clearSuspenseBoundary = shim;
/** 从根容器删除 Activity 边界内容的占位。 */
export const clearActivityBoundaryFromContainer = shim;
/** 从根容器删除 Suspense 边界内容的占位。 */
export const clearSuspenseBoundaryFromContainer = shim;
/** 在保留 DOM 的同时隐藏 dehydrated 边界的占位。 */
export const hideDehydratedBoundary = shim;
/** 恢复 dehydrated 边界可见性的占位。 */
export const unhideDehydratedBoundary = shim;
/** 判断 hydration 后多余的尾部宿主实例是否应删除的占位。 */
export const shouldDeleteUnhydratedTailInstances = shim;
/** 开发构建中生成已认领元素 props 差异的占位。 */
export const diffHydratedPropsForDevWarnings = shim;
/** 开发构建中生成已认领文本差异的占位。 */
export const diffHydratedTextForDevWarnings = shim;
/** 把可认领宿主实例描述成 hydration warning 节点的占位。 */
export const describeHydratableInstanceForDevWarnings = shim;
/** 在真正认领前校验宿主元素并报告开发警告的占位。 */
export const validateHydratableInstance = shim;
/** 在真正认领前校验宿主文本并报告开发警告的占位。 */
export const validateHydratableTextInstance = shim;
