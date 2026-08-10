/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 这是 npm `react-reconciler` 供第三方 renderer 使用的 HostConfig 适配层。
//
// 对外 API 把 HostConfig 作为参数传入，reconciler 内部却把它当模块 import；本文件
// 在两种模型之间转接。
//
// bundle 外层大致包装为：
//
// module.exports = function ($$$config) {
//   /* reconciler code */
// }
//
// 因此 `$$$config` 看似全局变量，实际是顶层包装函数的参数。

/** npm 工厂包装函数传入的第三方 HostConfig 对象。 */
declare const $$$config: any;
/** renderer 使用的宿主节点类型标识。 */
export opaque type Type = mixed;
/** renderer 宿主节点接收的属性。 */
export opaque type Props = mixed;
/** 根或 Portal 对应的宿主容器。 */
export opaque type Container = mixed;
/** renderer 创建的宿主元素实例。 */
export opaque type Instance = mixed;
/** renderer 创建的宿主文本实例。 */
export opaque type TextInstance = mixed;
/** hydration 中 Activity 边界的宿主占位实例。 */
export opaque type ActivityInstance = mixed;
/** hydration 中 Suspense 边界的宿主占位实例。 */
export opaque type SuspenseInstance = mixed;
/** 可被 hydration 匹配的任意宿主实例。 */
export opaque type HydratableInstance = mixed;
/** 暴露给用户 ref 的公开宿主实例。 */
export opaque type PublicInstance = mixed;
/** renderer 在宿主树层级间传播的上下文。 */
export opaque type HostContext = mixed;
/** prepare/update 阶段生成、供 commit 使用的宿主更新载荷。 */
export opaque type UpdatePayload = mixed;
/** persistence renderer 构造的新容器子集。 */
export opaque type ChildSet = mixed;
/** renderer 定时器 API 返回的句柄。 */
export opaque type TimeoutHandle = mixed;
/** 表示没有活动定时器的 renderer 哨兵。 */
export opaque type NoTimeout = mixed;
/** DevTools renderer inspection 的可选配置。 */
export opaque type RendererInspectionConfig = mixed;
/** 宿主 Transition Context 向后代传播的状态。 */
export opaque type TransitionStatus = mixed;
/** React DOM 风格表单宿主实例。 */
export opaque type FormInstance = mixed;
/** 提交因宿主资源挂起时保存的 renderer 状态。 */
export opaque type SuspendedState = mixed;
/** renderer 正在执行的宿主 View Transition。 */
export type RunningViewTransition = mixed;
/** reconciler 为具名 ViewTransition 保存的 renderer 句柄。 */
export type ViewTransitionInstance = null | {
  /** 宿主 View Transition 使用的稳定名称。 */
  name: string,
  ...
};
/** View Transition 布局比较使用的宿主测量结果。 */
export opaque type InstanceMeasurement = mixed;
/** 可响应实验事件系统的宿主 responder。 */
export type EventResponder = any;
/** 手势 Transition 用来读取进度的宿主时间线。 */
export type GestureTimeline = any;
/** 第三方 renderer 当前不提供 FragmentInstance。 */
export type FragmentInstanceType = null;

/** 向 DevTools 报告的第三方 renderer 版本。 */
export const rendererVersion = $$$config.rendererVersion;
/** 向 DevTools 报告的第三方 renderer 包名。 */
export const rendererPackageName = $$$config.rendererPackageName;
/** renderer 追加到 DevTools 注册信息的配置。 */
export const extraDevToolsConfig = $$$config.extraDevToolsConfig;

/** 把内部宿主实例转换为 ref 可见的公开实例。 */
export const getPublicInstance = $$$config.getPublicInstance;
/** 读取根容器的初始 HostContext。 */
export const getRootHostContext = $$$config.getRootHostContext;
/** 根据父 Context 与宿主类型计算 child HostContext。 */
export const getChildHostContext = $$$config.getChildHostContext;
/** commit 前保存选择、事件或其他宿主全局状态。 */
export const prepareForCommit = $$$config.prepareForCommit;
/** commit 后恢复宿主全局状态。 */
export const resetAfterCommit = $$$config.resetAfterCommit;
/** 为新的 HostComponent 创建宿主实例。 */
export const createInstance = $$$config.createInstance;
/** 在可变 renderer 中克隆已有宿主实例。 */
export const cloneMutableInstance = $$$config.cloneMutableInstance;
/** 构建阶段把 child 附加到尚未提交的宿主父实例。 */
export const appendInitialChild = $$$config.appendInitialChild;
/** 完成新宿主实例并判断 commit 时是否还需执行 mount。 */
export const finalizeInitialChildren = $$$config.finalizeInitialChildren;
/** 判断宿主类型是否直接管理文本而不创建 Text Fiber。 */
export const shouldSetTextContent = $$$config.shouldSetTextContent;
/** 创建宿主文本实例。 */
export const createTextInstance = $$$config.createTextInstance;
/** 在可变 renderer 中克隆已有文本实例。 */
export const cloneMutableTextInstance = $$$config.cloneMutableTextInstance;
/** 通过宿主环境安排超时回调。 */
export const scheduleTimeout = $$$config.scheduleTimeout;
/** 取消宿主超时句柄。 */
export const cancelTimeout = $$$config.cancelTimeout;
/** renderer 表示“无超时”的哨兵值。 */
export const noTimeout = $$$config.noTimeout;
/** 当前 HostConfig 是否占用 Context 的主 renderer 槽位。 */
export const isPrimaryRenderer = $$$config.isPrimaryRenderer;
/** renderer 是否要求在 act 作用域外更新时警告。 */
export const warnsIfNotActing = $$$config.warnsIfNotActing;
/** renderer 是否支持原地 mutation 提交模式。 */
export const supportsMutation = $$$config.supportsMutation;
/** renderer 是否支持克隆树的 persistence 提交模式。 */
export const supportsPersistence = $$$config.supportsPersistence;
/** renderer 是否支持复用既有宿主标记的 hydration。 */
export const supportsHydration = $$$config.supportsHydration;
/** 从宿主节点反查对应内部实例。 */
export const getInstanceFromNode = $$$config.getInstanceFromNode;
/** 活跃实例失焦前执行 renderer 特定准备。 */
export const beforeActiveInstanceBlur = $$$config.beforeActiveInstanceBlur;
/** 活跃实例失焦后执行 renderer 特定收尾。 */
export const afterActiveInstanceBlur = $$$config.afterActiveInstanceBlur;
/** Portal 首次挂载前准备其宿主容器。 */
export const preparePortalMount = $$$config.preparePortalMount;
/** Scope 实例变化后同步 renderer 的查询映射。 */
export const prepareScopeUpdate = $$$config.prepareScopeUpdate;
/** 从公开 Scope 对象反查对应 Fiber。 */
export const getInstanceFromScope = $$$config.getInstanceFromScope;
/** 写入 renderer 当前事件更新优先级。 */
export const setCurrentUpdatePriority = $$$config.setCurrentUpdatePriority;
/** 读取 renderer 当前事件更新优先级。 */
export const getCurrentUpdatePriority = $$$config.getCurrentUpdatePriority;
/** 在没有显式优先级时根据宿主事件推导更新优先级。 */
export const resolveUpdatePriority = $$$config.resolveUpdatePriority;
/** 把调度事件记录到 renderer 性能轨道。 */
export const trackSchedulerEvent = $$$config.trackSchedulerEvent;
/** 解析当前宿主事件类型。 */
export const resolveEventType = $$$config.resolveEventType;
/** 解析当前宿主事件时间戳。 */
export const resolveEventTimeStamp = $$$config.resolveEventTimeStamp;
/** 判断当前宿主事件是否值得提前尝试 Transition。 */
export const shouldAttemptEagerTransition =
  $$$config.shouldAttemptEagerTransition;
/** Fiber 删除后断开宿主实例上的内部引用。 */
export const detachDeletedInstance = $$$config.detachDeletedInstance;
/** 安排浏览器绘制后的回调。 */
export const requestPostPaintCallback = $$$config.requestPostPaintCallback;
/** 判断新挂载实例是否可能让 commit 等待资源。 */
export const maySuspendCommit = $$$config.maySuspendCommit;
/** 判断更新已有实例是否可能让 commit 等待资源。 */
export const maySuspendCommitOnUpdate = $$$config.maySuspendCommitOnUpdate;
/** 判断同步渲染中的实例是否仍可能挂起 commit。 */
export const maySuspendCommitInSyncRender =
  $$$config.maySuspendCommitInSyncRender;
/** 尝试预加载一个即将提交的宿主实例。 */
export const preloadInstance = $$$config.preloadInstance;
/** 开始收集本次 commit 等待的宿主资源。 */
export const startSuspendingCommit = $$$config.startSuspendingCommit;
/** 把实例对应资源加入本次 commit 等待集。 */
export const suspendInstance = $$$config.suspendInstance;
/** 活跃 View Transition 阻塞提交时加入等待。 */
export const suspendOnActiveViewTransition =
  $$$config.suspendOnActiveViewTransition;
/** 返回 commit 准备完成时触发的取消/继续回调。 */
export const waitForCommitToBeReady = $$$config.waitForCommitToBeReady;
/** 生成本次 commit 挂起原因，供性能与诊断使用。 */
export const getSuspendedCommitReason = $$$config.getSuspendedCommitReason;
/** 表示宿主 Transition 当前没有待处理工作的状态。 */
export const NotPendingTransition = $$$config.NotPendingTransition;
/** 向宿主 Transition provider 后代传播状态的内部 Context。 */
export const HostTransitionContext = $$$config.HostTransitionContext;
/** 提交成功后复位表单实例的 pending 状态。 */
export const resetFormInstance = $$$config.resetFormInstance;
/** 绑定 console 调用与 renderer 环境标签。 */
export const bindToConsole = $$$config.bindToConsole;

// ------------------- 可选：微任务 -------------------
/** renderer 是否提供可靠微任务队列。 */
export const supportsMicrotasks = $$$config.supportsMicrotasks;
/** 在宿主微任务队列安排回调。 */
export const scheduleMicrotask = $$$config.scheduleMicrotask;

// ------------------- 可选：测试选择器 -------------------
/** renderer 是否实现实验性测试选择器。 */
export const supportsTestSelectors = $$$config.supportsTestSelectors;
/** 从宿主容器定位对应 FiberRoot。 */
export const findFiberRoot = $$$config.findFiberRoot;
/** 读取宿主实例布局矩形。 */
export const getBoundingRect = $$$config.getBoundingRect;
/** 读取宿主实例可见文本内容。 */
export const getTextContent = $$$config.getTextContent;
/** 判断宿主实例子树是否隐藏。 */
export const isHiddenSubtree = $$$config.isHiddenSubtree;
/** 判断宿主实例是否匹配可访问性角色。 */
export const matchAccessibilityRole = $$$config.matchAccessibilityRole;
/** 若宿主实例可聚焦则把焦点移入。 */
export const setFocusIfFocusable = $$$config.setFocusIfFocusable;
/** 建立测试选择器用于可见性等待的 IntersectionObserver。 */
export const setupIntersectionObserver = $$$config.setupIntersectionObserver;

// ------------------- 可选：Mutation 模式 -------------------
/** 把宿主 child 追加到宿主父实例。 */
export const appendChild = $$$config.appendChild;
/** 把宿主 child 追加到根或 Portal 容器。 */
export const appendChildToContainer = $$$config.appendChildToContainer;
/** 提交宿主文本内容变化。 */
export const commitTextUpdate = $$$config.commitTextUpdate;
/** 新实例挂载后执行需要真实树位置的宿主操作。 */
export const commitMount = $$$config.commitMount;
/** 把 render 阶段计算的属性差异提交到宿主实例。 */
export const commitUpdate = $$$config.commitUpdate;
/** 在指定 sibling 前插入宿主 child。 */
export const insertBefore = $$$config.insertBefore;
/** 在容器的指定 sibling 前插入宿主 child。 */
export const insertInContainerBefore = $$$config.insertInContainerBefore;
/** 从宿主父实例删除 child。 */
export const removeChild = $$$config.removeChild;
/** 从根或 Portal 容器删除 child。 */
export const removeChildFromContainer = $$$config.removeChildFromContainer;
/** 清空宿主实例直接管理的文本内容。 */
export const resetTextContent = $$$config.resetTextContent;
/** 以宿主方式隐藏元素实例。 */
export const hideInstance = $$$config.hideInstance;
/** 以宿主方式隐藏文本实例。 */
export const hideTextInstance = $$$config.hideTextInstance;
/** 恢复元素实例可见并应用最新属性。 */
export const unhideInstance = $$$config.unhideInstance;
/** 恢复文本实例可见并应用最新文本。 */
export const unhideTextInstance = $$$config.unhideTextInstance;
/** 为宿主实例设置本次 View Transition 名称。 */
export const applyViewTransitionName = $$$config.applyViewTransitionName;
/** 恢复宿主实例先前的 View Transition 名称。 */
export const restoreViewTransitionName = $$$config.restoreViewTransitionName;
/** 取消实例级 View Transition 名称设置。 */
export const cancelViewTransitionName = $$$config.cancelViewTransitionName;
/** 取消根容器的 View Transition 名称。 */
export const cancelRootViewTransitionName =
  $$$config.cancelRootViewTransitionName;
/** 恢复根容器先前的 View Transition 名称。 */
export const restoreRootViewTransitionName =
  $$$config.restoreRootViewTransitionName;
/** 为根级 View Transition 创建可测量的宿主克隆。 */
export const cloneRootViewTransitionContainer =
  $$$config.cloneRootViewTransitionContainer;
/** 删除根级 View Transition 使用完的宿主克隆。 */
export const removeRootViewTransitionClone =
  $$$config.removeRootViewTransitionClone;
/** 测量原始宿主实例的布局与视觉属性。 */
export const measureInstance = $$$config.measureInstance;
/** 测量 View Transition 克隆实例。 */
export const measureClonedInstance = $$$config.measureClonedInstance;
/** 判断原实例在捕获快照时是否位于视口。 */
export const wasInstanceInViewport = $$$config.wasInstanceInViewport;
/** 判断新旧实例测量值是否需要动画。 */
export const hasInstanceChanged = $$$config.hasInstanceChanged;
/** 判断实例变化是否影响父级 View Transition。 */
export const hasInstanceAffectedParent = $$$config.hasInstanceAffectedParent;
/** 启动一次宿主 View Transition 并接收 React 提交阶段回调。 */
export const startViewTransition = $$$config.startViewTransition;
/** 依据手势时间线启动可交互宿主 View Transition。 */
export const startGestureTransition = $$$config.startGestureTransition;
/** 停止并清理正在运行的宿主 View Transition。 */
export const stopViewTransition = $$$config.stopViewTransition;
/** 登记宿主 View Transition 全部完成后的监听器。 */
export const addViewTransitionFinishedListener =
  $$$config.addViewTransitionFinishedListener;
/** 读取手势时间线当前百分比偏移。 */
export const getCurrentGestureOffset = $$$config.getCurrentGestureOffset;
/** 为具名 Fiber 创建 renderer ViewTransitionInstance。 */
export const createViewTransitionInstance =
  $$$config.createViewTransitionInstance;
/** 清空根或 Portal 容器的全部宿主 children。 */
export const clearContainer = $$$config.clearContainer;
/** 创建实验 Fragment ref 的宿主实例。 */
export const createFragmentInstance = $$$config.createFragmentInstance;
/** Fiber 复用时更新 FragmentInstance 指向的内部 Fiber。 */
export const updateFragmentInstanceFiber =
  $$$config.updateFragmentInstanceFiber;
/** 新 child 提交后把它登记到 FragmentInstance。 */
export const commitNewChildToFragmentInstance =
  $$$config.commitNewChildToFragmentInstance;
/** child 删除后从 FragmentInstance 解除登记。 */
export const deleteChildFromFragmentInstance =
  $$$config.deleteChildFromFragmentInstance;

// ------------------- 可选：Persistence 模式 -------------------
/** 基于旧实例与新属性克隆 persistence 宿主实例。 */
export const cloneInstance = $$$config.cloneInstance;
/** 为容器创建未提交的 child 集合。 */
export const createContainerChildSet = $$$config.createContainerChildSet;
/** 把实例追加到未提交的容器 child 集合。 */
export const appendChildToContainerChildSet =
  $$$config.appendChildToContainerChildSet;
/** 完成容器 child 集合，允许 renderer 做提交前准备。 */
export const finalizeContainerChildren = $$$config.finalizeContainerChildren;
/** 原子地用新 child 集合替换容器内容。 */
export const replaceContainerChildren = $$$config.replaceContainerChildren;
/** 克隆并以隐藏状态保存宿主元素实例。 */
export const cloneHiddenInstance = $$$config.cloneHiddenInstance;
/** 克隆并以隐藏状态保存宿主文本实例。 */
export const cloneHiddenTextInstance = $$$config.cloneHiddenTextInstance;

// ------------------- 可选：Hydration -------------------
/** 判断 Suspense 宿主占位是否仍等待服务端内容。 */
export const isSuspenseInstancePending = $$$config.isSuspenseInstancePending;
/** 判断 Suspense 宿主占位是否编码了服务端 fallback。 */
export const isSuspenseInstanceFallback = $$$config.isSuspenseInstanceFallback;
/** 读取服务端 Suspense fallback 携带的错误详情。 */
export const getSuspenseInstanceFallbackErrorDetails =
  $$$config.getSuspenseInstanceFallbackErrorDetails;
/** 在 Suspense 宿主占位可重试时登记回调。 */
export const registerSuspenseInstanceRetry =
  $$$config.registerSuspenseInstanceRetry;
/** 判断当前 hydratable 节点能否作为表单状态标记。 */
export const canHydrateFormStateMarker = $$$config.canHydrateFormStateMarker;
/** 判断表单状态标记与本次请求是否匹配。 */
export const isFormStateMarkerMatching = $$$config.isFormStateMarkerMatching;
/** 返回指定 hydratable 实例之后的下一个候选 sibling。 */
export const getNextHydratableSibling = $$$config.getNextHydratableSibling;
/** 越过 Singleton 范围后查找下一个 hydratable sibling。 */
export const getNextHydratableSiblingAfterSingleton =
  $$$config.getNextHydratableSiblingAfterSingleton;
/** 返回宿主实例的首个 hydratable child。 */
export const getFirstHydratableChild = $$$config.getFirstHydratableChild;
/** 返回根或 Portal 容器内首个 hydratable child。 */
export const getFirstHydratableChildWithinContainer =
  $$$config.getFirstHydratableChildWithinContainer;
/** 返回 Activity 宿主边界内首个 hydratable child。 */
export const getFirstHydratableChildWithinActivityInstance =
  $$$config.getFirstHydratableChildWithinActivityInstance;
/** 返回 Suspense 宿主边界内首个 hydratable child。 */
export const getFirstHydratableChildWithinSuspenseInstance =
  $$$config.getFirstHydratableChildWithinSuspenseInstance;
/** 返回 Singleton 宿主范围内首个 hydratable child。 */
export const getFirstHydratableChildWithinSingleton =
  $$$config.getFirstHydratableChildWithinSingleton;
/** 判断候选宿主节点能否复用为指定 HostComponent。 */
export const canHydrateInstance = $$$config.canHydrateInstance;
/** 判断候选宿主节点能否复用为指定文本。 */
export const canHydrateTextInstance = $$$config.canHydrateTextInstance;
/** 判断候选宿主占位能否复用为 Activity 边界。 */
export const canHydrateActivityInstance = $$$config.canHydrateActivityInstance;
/** 判断候选宿主占位能否复用为 Suspense 边界。 */
export const canHydrateSuspenseInstance = $$$config.canHydrateSuspenseInstance;
/** 把既有宿主实例连接到 HostComponent Fiber 并返回属性差异。 */
export const hydrateInstance = $$$config.hydrateInstance;
/** 把既有宿主文本连接到 Text Fiber 并报告内容差异。 */
export const hydrateTextInstance = $$$config.hydrateTextInstance;
/** 初始化已匹配 Activity 宿主边界的 hydration 状态。 */
export const hydrateActivityInstance = $$$config.hydrateActivityInstance;
/** 初始化已匹配 Suspense 宿主边界的 hydration 状态。 */
export const hydrateSuspenseInstance = $$$config.hydrateSuspenseInstance;
/** 越过 Activity 边界后查找下一个 hydratable 实例。 */
export const getNextHydratableInstanceAfterActivityInstance =
  $$$config.getNextHydratableInstanceAfterActivityInstance;
/** 越过 Suspense 边界后查找下一个 hydratable 实例。 */
export const getNextHydratableInstanceAfterSuspenseInstance =
  $$$config.getNextHydratableInstanceAfterSuspenseInstance;
/** HostComponent hydration 成功提交后的 renderer 回调。 */
export const commitHydratedInstance = $$$config.commitHydratedInstance;
/** 根容器 hydration 成功提交后的 renderer 回调。 */
export const commitHydratedContainer = $$$config.commitHydratedContainer;
/** Activity 边界 hydration 成功提交后的 renderer 回调。 */
export const commitHydratedActivityInstance =
  $$$config.commitHydratedActivityInstance;
/** Suspense 边界 hydration 成功提交后的 renderer 回调。 */
export const commitHydratedSuspenseInstance =
  $$$config.commitHydratedSuspenseInstance;
/** 完成一组 hydration children 后执行 renderer 校正。 */
export const finalizeHydratedChildren = $$$config.finalizeHydratedChildren;
/** 提交后刷新 hydration 期间积累的宿主事件。 */
export const flushHydrationEvents = $$$config.flushHydrationEvents;
/** 清除 Activity 边界内部无法复用的宿主内容。 */
export const clearActivityBoundary = $$$config.clearActivityBoundary;
/** 清除 Suspense 边界内部无法复用的宿主内容。 */
export const clearSuspenseBoundary = $$$config.clearSuspenseBoundary;
/** 从容器层级清除 Activity 边界及其内容。 */
export const clearActivityBoundaryFromContainer =
  $$$config.clearActivityBoundaryFromContainer;
/** 从容器层级清除 Suspense 边界及其内容。 */
export const clearSuspenseBoundaryFromContainer =
  $$$config.clearSuspenseBoundaryFromContainer;
/** 以宿主方式隐藏 dehydrated 边界。 */
export const hideDehydratedBoundary = $$$config.hideDehydratedBoundary;
/** 以宿主方式重新显示 dehydrated 边界。 */
export const unhideDehydratedBoundary = $$$config.unhideDehydratedBoundary;
/** 判断 hydration 是否应删除未匹配的尾部宿主实例。 */
export const shouldDeleteUnhydratedTailInstances =
  $$$config.shouldDeleteUnhydratedTailInstances;
/** 生成属性 hydration 不一致的开发期差异。 */
export const diffHydratedPropsForDevWarnings =
  $$$config.diffHydratedPropsForDevWarnings;
/** 生成文本 hydration 不一致的开发期差异。 */
export const diffHydratedTextForDevWarnings =
  $$$config.diffHydratedTextForDevWarnings;
/** 把 hydratable 实例描述为开发期 mismatch 诊断节点。 */
export const describeHydratableInstanceForDevWarnings =
  $$$config.describeHydratableInstanceForDevWarnings;
/** 在正式匹配前验证宿主实例 hydration 合法性。 */
export const validateHydratableInstance = $$$config.validateHydratableInstance;
/** 在正式匹配前验证宿主文本 hydration 合法性。 */
export const validateHydratableTextInstance =
  $$$config.validateHydratableTextInstance;

// ------------------- 可选：可提升资源 -------------------
/** 可接收 hoistable 资源的宿主根作用域。 */
export type HoistableRoot = mixed;
/** renderer 管理的可共享或可提升资源记录。 */
export type Resource = mixed;
/** renderer 是否实现资源提升与生命周期。 */
export const supportsResources = $$$config.supportsResources;
/** 判断宿主类型是否应作为 Hoistable 资源处理。 */
export const isHostHoistableType = $$$config.isHostHoistableType;
/** 找到实例应提升到的 HoistableRoot。 */
export const getHoistableRoot = $$$config.getHoistableRoot;
/** 从属性解析或复用 renderer Resource。 */
export const getResource = $$$config.getResource;
/** 提交挂载时增加 Resource 宿主引用。 */
export const acquireResource = $$$config.acquireResource;
/** 提交卸载时释放 Resource 宿主引用。 */
export const releaseResource = $$$config.releaseResource;
/** 复用服务端已存在的 Hoistable 实例。 */
export const hydrateHoistable = $$$config.hydrateHoistable;
/** 把新 Hoistable 实例挂入目标根。 */
export const mountHoistable = $$$config.mountHoistable;
/** 从目标根卸载 Hoistable 实例。 */
export const unmountHoistable = $$$config.unmountHoistable;
/** 创建新的 Hoistable 宿主实例。 */
export const createHoistableInstance = $$$config.createHoistableInstance;
/** 主 commit 前准备资源提升顺序与目标。 */
export const prepareToCommitHoistables = $$$config.prepareToCommitHoistables;
/** 判断 Resource 是否可能让 commit 挂起。 */
export const mayResourceSuspendCommit = $$$config.mayResourceSuspendCommit;
/** 尝试预加载即将使用的 Resource。 */
export const preloadResource = $$$config.preloadResource;
/** 把 Resource 加入本次 commit 等待集。 */
export const suspendResource = $$$config.suspendResource;

// ------------------- 可选：宿主 Singleton -------------------
/** renderer 是否实现全局唯一宿主节点。 */
export const supportsSingletons = $$$config.supportsSingletons;
/** 为 Fiber 解析现有或待创建的 Singleton 实例。 */
export const resolveSingletonInstance = $$$config.resolveSingletonInstance;
/** 提交挂载时取得并配置 Singleton 实例。 */
export const acquireSingletonInstance = $$$config.acquireSingletonInstance;
/** 提交卸载时释放并复位 Singleton 实例。 */
export const releaseSingletonInstance = $$$config.releaseSingletonInstance;
/** 判断宿主类型是否属于 Singleton。 */
export const isHostSingletonType = $$$config.isHostSingletonType;
/** 判断当前宿主 Context 是否允许该 Singleton 类型。 */
export const isSingletonScope = $$$config.isSingletonScope;
