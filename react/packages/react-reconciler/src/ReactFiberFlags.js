/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {
  enableCreateEventHandleAPI,
  enableEffectEventMutationPhase,
} from 'shared/ReactFeatureFlags';

/** Fiber 本节点在 render/commit 生命周期中的按位标记集合。 */
export type Flags = number;

// 下列位会被 React DevTools 读取，不得重排或改值。
/** 当前 Fiber 没有待处理标记。 */
export const NoFlags = /*                      */ 0b0000000000000000000000000000000;
/** 标记该 Fiber 本轮实际执行过工作，供 bailout 与 DevTools 判断。 */
export const PerformedWork = /*                */ 0b0000000000000000000000000000001;
/** commit 时需要把新 Fiber 对应的宿主节点插入或移动到目标位置。 */
export const Placement = /*                    */ 0b0000000000000000000000000000010;
/** render 阶段的 Suspense 或错误边界已经捕获一次抛出。 */
export const DidCapture = /*                   */ 0b0000000000000000000000010000000;
/** 当前 Fiber 正在认领服务端已有的宿主节点。 */
export const Hydrating = /*                    */ 0b0000000000000000001000000000000;

// 其余位不属于 DevTools 固定协议，可按内部需要演进。
/** commit 时需要更新宿主实例，或执行该 Fiber 类型复用的更新语义。 */
export const Update = /*                       */ 0b0000000000000000000000000000100;
/** persistence renderer 已克隆该 Fiber 的宿主实例，父克隆树需采用它。 */
export const Cloned = /*                       */ 0b0000000000000000000000000001000;

/** 该 Fiber 的 deletions 列表包含需要在 commit 卸载的旧 children。 */
export const ChildDeletion = /*                */ 0b0000000000000000000000000010000;
/** 写入新 children 前需清空宿主节点既有的直接文本内容。 */
export const ContentReset = /*                 */ 0b0000000000000000000000000100000;
/** commit layout 阶段需要执行 class/root update queue 中的回调。 */
export const Callback = /*                     */ 0b0000000000000000000000001000000;
/* DidCapture 占用：                              0b0000000000000000000000010000000; */

/** hydration 无法继续复用服务端内容，必须删除并改走客户端 render。 */
export const ForceClientRender = /*            */ 0b0000000000000000000000100000000;
/** commit 时需要先 detach 旧 ref，再在 layout 阶段 attach 新 ref。 */
export const Ref = /*                          */ 0b0000000000000000000001000000000;
/** before-mutation 阶段需要读取 class snapshot 或执行复用的快照语义。 */
export const Snapshot = /*                     */ 0b0000000000000000000010000000000;
/** 该 Fiber 有被动 effect 需要在 commit 主体之后挂载或清理。 */
export const Passive = /*                      */ 0b0000000000000000000100000000000;
/* Hydrating 占用：                               0b0000000000000000001000000000000; */

/** Offscreen/Activity 等边界的可见性发生变化。 */
export const Visibility = /*                   */ 0b0000000000000000010000000000000;
/** commit 前需复核 useSyncExternalStore 快照，防止撕裂。 */
export const StoreConsistency = /*             */ 0b0000000000000000100000000000000;

// 下列语义只出现在互斥的 Fiber 类型或阶段，因此可复用位；位空间已经紧张，复用可避免扩宽字段。
/** HostRoot 首次提交时需要完成容器 hydration；与普通 Callback 语义互斥。 */
export const Hydrate = Callback;
/** completeWork 需立即安排 retry Lane 以预渲染未探索的挂起子树；与 store consistency 互斥。 */
export const ScheduleRetry = StoreConsistency;
/** 资源尚未准备好，当前 commit 必须挂起；与普通 visibility 更新互斥。 */
export const ShouldSuspendCommit = Visibility;
/** 新挂载的命名 ViewTransition 需要参与 commit 挂起/捕获。 */
export const ViewTransitionNamedMount = ShouldSuspendCommit;
/** primary Suspense children 本轮发生延后，下一轮 beginWork 需要识别。 */
export const DidDefer = ContentReset;
/** form action 完成后需在 commit 阶段重置表单。 */
export const FormReset = Snapshot;
/** ViewTransition 的后代布局变化会影响父 transition 的测量与动画。 */
export const AffectedParentLayout = ContentReset;

/** 需要在单次 commit 生命周期内执行的组件级 effect 位集合。 */
export const LifecycleEffectMask =
  Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

/** 单次 commit 会消费的全部低位宿主 effect；完成后可从新 work-in-progress 清除。 */
export const HostEffectMask = /*               */ 0b0000000000000000111111111111111;

// 以下是 render 状态而非真正副作用，但复用同一 flags 字段以保持 Fiber 紧凑。
/** 当前 Fiber 未能完成，unwind 路径需要处理其祖先。 */
export const Incomplete = /*                   */ 0b0000000000000001000000000000000;
/** 最近可捕获的边界应在 unwind 后切换到错误或 Suspense fallback。 */
export const ShouldCapture = /*                */ 0b0000000000000010000000000000000;
/** 旧版 Suspense 兼容路径需强制重新计算一次 class 更新。 */
export const ForceUpdateForLegacySuspense = /* */ 0b0000000000000100000000000000000;
/** 已检查祖先 Provider 的变化并向子树传播，后代 bailout 可避免重复检查同一段祖先链。 */
export const DidPropagateContext = /*          */ 0b0000000000001000000000000000000;
/** 子树仍需执行惰性 Context 传播。 */
export const NeedsPropagation = /*             */ 0b0000000000010000000000000000000;

// 静态标记描述跨 render 保持的 Fiber 属性，例如“这个 Fiber 使用过 passive effect”；
// 即使本轮没有更新，卸载路径也能据此跳过不可能含清理工作的子树，避免重新遍历推断。
/** 该 Fiber 由数组协调的 fork 路径创建，需要维持相关静态语义。 */
export const Forked = /*                       */ 0b0000000000100000000000000000000;
/** 子树在卸载/快照阶段仍可能有静态工作。 */
export const SnapshotStatic = /*               */ 0b0000000001000000000000000000000;
/** 子树存在 layout effect 或需在 layout 卸载路径访问的节点。 */
export const LayoutStatic = /*                 */ 0b0000000010000000000000000000000;
/** ref 的静态清理需求与 layout 路径一致，复用同一位。 */
export const RefStatic = LayoutStatic;
/** 子树存在 passive effect，卸载时即使本轮未更新也必须访问。 */
export const PassiveStatic = /*                */ 0b0000000100000000000000000000000;
/** 子树的资源或宿主实例可能要求 commit 等待。 */
export const MaySuspendCommit = /*             */ 0b0000001000000000000000000000000;
// 深层命名 ViewTransition 在清理时仍需访问；它与 snapshot 类工作相似，并需与
// MaySuspendCommit 的扫描发生在同一阶段。
/** 子树含显式命名的 ViewTransition，快照与 commit 挂起扫描都不能跳过。 */
export const ViewTransitionNamedStatic =
  /*    */ SnapshotStatic | MaySuspendCommit;
// 从最近 HostComponent 向下追踪 ViewTransition；跨过新的 HostComponent 时重新开始聚合。
/** 当前宿主节点以下含 ViewTransition，可用于局部跳过不存在 transition 的分支。 */
export const ViewTransitionStatic = /*         */ 0b0000010000000000000000000000000;
// parentEnter/parentExit 会影响宿主祖先，因此该位不像 ViewTransitionStatic 那样在 HostComponent 清除。
/** 子树含会影响父级的 ViewTransition，供向父遍历时快速剪枝。 */
export const ViewTransitionStaticParent = /*   */ 0b1000000000000000000000000000000;
/** 子树含 HostPortal；跨容器 effect 与 transition 遍历不能把它当普通宿主后代。 */
export const PortalStatic = /*                 */ 0b0000100000000000000000000000000;

/** 开发构建中标记本轮新插入 Fiber；commit 后不清除，下一轮 createWorkInProgress 会重置。 */
export const PlacementDEV = /*                 */ 0b0001000000000000000000000000000;
/** StrictEffects 开发检查需重新挂载 layout effects。 */
export const MountLayoutDev = /*               */ 0b0010000000000000000000000000000;
/** StrictEffects 开发检查需重新挂载 passive effects。 */
export const MountPassiveDev = /*              */ 0b0100000000000000000000000000000;

// commit 各阶段用这些 mask 检查 subtreeFlags，直接跳过不含对应 effect 的整棵子树。

/** before-mutation 阶段需访问的 snapshot、焦点与 Effect Event 更新集合。 */
export const BeforeMutationMask: number =
  Snapshot |
  (enableCreateEventHandleAPI
    ? // createEventHandle 为触发 beforeblur，必须访问删除及隐藏的树。
      // TODO：只有元素获得焦点时，before-mutation 才需要访问 deletion。
      Update | ChildDeletion | Visibility
    : // useEffectEvent 旧路径在 snapshot 阶段更新；开关启用后会移到 mutation 阶段。
      enableEffectEventMutationPhase
      ? 0
      : Update);

/** View Transition 在 mutation 前后扫描可能受影响节点时使用的 effect 集合。 */
export const BeforeAndAfterMutationTransitionMask: number =
  Snapshot | Update | Placement | ChildDeletion | Visibility | ContentReset;

/** mutation 阶段可能改变宿主树、ref 或可见性的 effect 集合。 */
export const MutationMask =
  Placement |
  Update |
  ChildDeletion |
  ContentReset |
  Ref |
  Hydrating |
  Visibility |
  FormReset;
/** layout 阶段需执行生命周期、update callback、ref attach 或可见性工作的集合。 */
export const LayoutMask = Update | Callback | Ref | Visibility;

// TODO：挂载与卸载访问条件不同，可拆成 PassiveMountMask 和 PassiveUnmountMask。
/** passive 阶段需访问的 effect；删除与隐藏会触发被动 cleanup。 */
export const PassiveMask = Passive | Visibility | ChildDeletion;

/** View Transition commit 后恢复 view-transition-name 时需重访的 passive/update/placement 集合。 */
export const PassiveTransitionMask: number = PassiveMask | Update | Placement;

/**
 * 克隆 Fiber 时不会清除的静态位集合。
 *
 * 它让“子树是否含 passive effect、Portal 或 transition”等事实跨 render 保持，无需每轮从头推导。
 */
export const StaticMask =
  LayoutStatic |
  PassiveStatic |
  RefStatic |
  MaySuspendCommit |
  ViewTransitionStatic |
  ViewTransitionStaticParent |
  ViewTransitionNamedStatic |
  PortalStatic |
  Forked;
