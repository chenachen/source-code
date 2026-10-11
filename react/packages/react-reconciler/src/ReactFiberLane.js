/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Transition} from 'react/src/ReactStartTransition';
import type {ConcurrentUpdate} from './ReactFiberConcurrentUpdates';

// TODO：理想上应使用 opaque type 防止任意数字混入；但 fork 基础设施会把这些类型泄漏到
// reconciler 外部包，当前 Flow 无法稳定处理该边界。

/** 一组待处理更新优先级的 31 位 bitmask。 */
export type Lanes = number;
/** 单个更新优先级的 one-hot 位；NoLane 例外为零。 */
export type Lane = number;
/** 按 Lane 位索引保存元数据的定长数组。 */
export type LaneMap<T> = Array<T>;

import {
  enableRetryLaneExpiration,
  enableSchedulingProfiler,
  enableTransitionTracing,
  enableUpdaterTracking,
  syncLaneExpirationMs,
  transitionLaneExpirationMs,
  retryLaneExpirationMs,
  disableLegacyMode,
  enableDefaultTransitionIndicator,
  enableGestureTransition,
  enableParallelTransitions,
} from 'shared/ReactFeatureFlags';
import {isDevToolsPresent} from './ReactFiberDevToolsHook';
import {clz32} from './clz32';
import {LegacyRoot} from './ReactRootTags';

// 以下 Lane 位值须与 react-devtools-timeline 使用的 getLabelForLane 同步；改值后必须重建并发布 DevTools 包。

/** JavaScript 有符号 32 位 bitwise 可安全使用的 Lane 数量。 */
export const TotalLanes = 31;

/** 空 Lane 集合。 */
export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000;
/** 未分配单 Lane。 */
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000;

/** 同步事件触发、必须立即认领的 hydration 工作。 */
export const SyncHydrationLane: Lane = /*               */ 0b0000000000000000000000000000001;
/** 同步更新与离散事件工作。 */
export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000010;
/** SyncLane 在 LaneMap 中的固定索引。 */
export const SyncLaneIndex: number = 1;

/** 连续输入触发的 hydration 工作。 */
export const InputContinuousHydrationLane: Lane = /*    */ 0b0000000000000000000000000000100;
/** scroll/mousemove 等连续输入更新。 */
export const InputContinuousLane: Lane = /*             */ 0b0000000000000000000000000001000;

/** 默认优先级触发的 hydration 工作。 */
export const DefaultHydrationLane: Lane = /*            */ 0b0000000000000000000000000010000;
/** 普通非 transition 更新。 */
export const DefaultLane: Lane = /*                     */ 0b0000000000000000000000000100000;

/** 最高优先级选择与 flushSync 共用的同步、连续、默认合批集合。 */
export const SyncUpdateLanes: Lane =
  SyncLane | InputContinuousLane | DefaultLane;

/** 手势驱动 View Transition 的专用 render Lane。 */
export const GestureLane: Lane = /*                     */ 0b0000000000000000000000001000000;

/** transition 触发 hydration 时使用的共享 Lane。 */
const TransitionHydrationLane: Lane = /*                */ 0b0000000000000000000000010000000;
/** 全部 transition update 与 deferred Lane 集合。 */
const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111100000000;
/** transition update 轮转池第 1 槽。 */
const TransitionLane1: Lane = /*                        */ 0b0000000000000000000000100000000;
/** transition update 轮转池第 2 槽。 */
const TransitionLane2: Lane = /*                        */ 0b0000000000000000000001000000000;
/** transition update 轮转池第 3 槽。 */
const TransitionLane3: Lane = /*                        */ 0b0000000000000000000010000000000;
/** transition update 轮转池第 4 槽。 */
const TransitionLane4: Lane = /*                        */ 0b0000000000000000000100000000000;
/** transition update 轮转池第 5 槽。 */
const TransitionLane5: Lane = /*                        */ 0b0000000000000000001000000000000;
/** transition update 轮转池第 6 槽。 */
const TransitionLane6: Lane = /*                        */ 0b0000000000000000010000000000000;
/** transition update 轮转池第 7 槽。 */
const TransitionLane7: Lane = /*                        */ 0b0000000000000000100000000000000;
/** transition update 轮转池第 8 槽。 */
const TransitionLane8: Lane = /*                        */ 0b0000000000000001000000000000000;
/** transition update 轮转池第 9 槽。 */
const TransitionLane9: Lane = /*                        */ 0b0000000000000010000000000000000;
/** transition update 轮转池第 10 槽。 */
const TransitionLane10: Lane = /*                       */ 0b0000000000000100000000000000000;
/** deferred transition 轮转池第 1 槽。 */
const TransitionLane11: Lane = /*                       */ 0b0000000000001000000000000000000;
/** deferred transition 轮转池第 2 槽。 */
const TransitionLane12: Lane = /*                       */ 0b0000000000010000000000000000000;
/** deferred transition 轮转池第 3 槽。 */
const TransitionLane13: Lane = /*                       */ 0b0000000000100000000000000000000;
/** deferred transition 轮转池第 4 槽。 */
const TransitionLane14: Lane = /*                       */ 0b0000000001000000000000000000000;

/** 供测试/调用方表示任意 transition Lane 的稳定代表值。 */
export const SomeTransitionLane: Lane = TransitionLane1;

/** 普通 transition 更新可轮转使用的十个 Lane。 */
const TransitionUpdateLanes =
  TransitionLane1 |
  TransitionLane2 |
  TransitionLane3 |
  TransitionLane4 |
  TransitionLane5 |
  TransitionLane6 |
  TransitionLane7 |
  TransitionLane8 |
  TransitionLane9 |
  TransitionLane10;
/** useDeferredValue 等派生工作专用的四个 transition Lane。 */
const TransitionDeferredLanes =
  TransitionLane11 | TransitionLane12 | TransitionLane13 | TransitionLane14;

/** Suspense retry 轮转池的全部 Lanes。 */
const RetryLanes: Lanes = /*                            */ 0b0000011110000000000000000000000;
/** Suspense retry 轮转池第 1 槽。 */
const RetryLane1: Lane = /*                             */ 0b0000000010000000000000000000000;
/** Suspense retry 轮转池第 2 槽。 */
const RetryLane2: Lane = /*                             */ 0b0000000100000000000000000000000;
/** Suspense retry 轮转池第 3 槽。 */
const RetryLane3: Lane = /*                             */ 0b0000001000000000000000000000000;
/** Suspense retry 轮转池第 4 槽。 */
const RetryLane4: Lane = /*                             */ 0b0000010000000000000000000000000;

/** 供测试/调用方表示任意 retry Lane 的稳定代表值。 */
export const SomeRetryLane: Lane = RetryLane1;

/** 事件命中 dehydrated 目标时提升该边界 hydration 的 Lane。 */
export const SelectiveHydrationLane: Lane = /*          */ 0b0000100000000000000000000000000;

/** 除 Idle/Offscreen/Deferred 等尾部位之外的所有非 idle 工作。 */
const NonIdleLanes: Lanes = /*                          */ 0b0000111111111111111111111111111;

/** idle 事件触发的 hydration 工作。 */
export const IdleHydrationLane: Lane = /*               */ 0b0001000000000000000000000000000;
/** 只有非 idle 工作完成后才选择的普通 idle 更新。 */
export const IdleLane: Lane = /*                        */ 0b0010000000000000000000000000000;

/** hidden Offscreen 子树更新附加的标记 Lane。 */
export const OffscreenLane: Lane = /*                   */ 0b0100000000000000000000000000000;
/** 标记由另一次 render 派生的 deferred 工作，用于防止级联 waterfall。 */
export const DeferredLane: Lane = /*                    */ 0b1000000000000000000000000000000;

/** 可由 setState/dispatch 等主动安排更新的 Lanes；无限更新检测排除 hydration 与 retry。 */
export const UpdateLanes: Lanes =
  SyncLane | InputContinuousLane | DefaultLane | TransitionUpdateLanes;

/** 所有专用于 hydration、不得与普通 update 混批的 Lanes。 */
export const HydrationLanes =
  SyncHydrationLane |
  InputContinuousHydrationLane |
  DefaultHydrationLane |
  TransitionHydrationLane |
  SelectiveHydrationLane |
  IdleHydrationLane;

/** 为实验性 DevTools timeline 返回 Lane 类别名；必须与上方位分配同步。 */
export function getLabelForLane(lane: Lane): string | void {
  if (enableSchedulingProfiler) {
    if (lane & SyncHydrationLane) {
      return 'SyncHydrationLane';
    }
    if (lane & SyncLane) {
      return 'Sync';
    }
    if (lane & InputContinuousHydrationLane) {
      return 'InputContinuousHydration';
    }
    if (lane & InputContinuousLane) {
      return 'InputContinuous';
    }
    if (lane & DefaultHydrationLane) {
      return 'DefaultHydration';
    }
    if (lane & DefaultLane) {
      return 'Default';
    }
    if (lane & TransitionHydrationLane) {
      return 'TransitionHydration';
    }
    if (lane & TransitionLanes) {
      return 'Transition';
    }
    if (lane & RetryLanes) {
      return 'Retry';
    }
    if (lane & SelectiveHydrationLane) {
      return 'SelectiveHydration';
    }
    if (lane & IdleHydrationLane) {
      return 'IdleHydration';
    }
    if (lane & IdleLane) {
      return 'Idle';
    }
    if (lane & OffscreenLane) {
      return 'Offscreen';
    }
    if (lane & DeferredLane) {
      return 'Deferred';
    }
  }
}

/** Lane 尚未开始饥饿计时或不参与过期的哨兵时间。 */
export const NoTimestamp = -1;

/** 下一个普通 transition update 要领取的轮转槽。 */
let nextTransitionUpdateLane: Lane = TransitionLane1;
/** 下一个 deferred transition 要领取的轮转槽。 */
let nextTransitionDeferredLane: Lane = TransitionLane11;
/** 下一个 Suspense retry 要领取的轮转槽。 */
let nextRetryLane: Lane = RetryLane1;

/**
 * 从集合中取应作为同一批 render 的最高优先级 Lane 组。
 * 同步更新合批；普通 transition 可按开关逐 Lane 或整组；deferred/retry 各自按池合批。
 */
function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes {
  const pendingSyncLanes = lanes & SyncUpdateLanes;
  if (pendingSyncLanes !== 0) {
    return pendingSyncLanes;
  }
  switch (getHighestPriorityLane(lanes)) {
    case SyncHydrationLane:
      return SyncHydrationLane;
    case SyncLane:
      return SyncLane;
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane;
    case InputContinuousLane:
      return InputContinuousLane;
    case DefaultHydrationLane:
      return DefaultHydrationLane;
    case DefaultLane:
      return DefaultLane;
    case GestureLane:
      return GestureLane;
    case TransitionHydrationLane:
      return TransitionHydrationLane;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
      if (enableParallelTransitions) {
        return getHighestPriorityLane(lanes);
      }
      return lanes & TransitionUpdateLanes;
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
      return lanes & TransitionDeferredLanes;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      return lanes & RetryLanes;
    case SelectiveHydrationLane:
      return SelectiveHydrationLane;
    case IdleHydrationLane:
      return IdleHydrationLane;
    case IdleLane:
      return IdleLane;
    case OffscreenLane:
      return OffscreenLane;
    case DeferredLane:
      // DeferredLane 总与实际工作 Lane 纠缠，不应单独成为最高位。
      return NoLanes;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      // 防御性回退：开发期报告不变量，仍返回完整集合避免静默丢工作。
      return lanes;
  }
}

/**
 * 从 FiberRoot 状态选择下一批 render Lanes。
 *
 * 顺序为非 idle 未挂起 → 已 ping → 未预热，再处理 idle；已有 render 只有遇到更高优先级或自身已挂起
 * 才中断。Default 更新刻意不打断 transition，以保留 refresh transition 语义。
 */
export function getNextLanes(
  root: FiberRoot,
  wipLanes: Lanes,
  rootHasPendingCommit: boolean,
): Lanes {
  // 根没有待处理工作时直接退出。
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  let nextLanes: Lanes = NoLanes;

  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const warmLanes = root.warmLanes;

  // 即使非 idle 工作已挂起，也必须先尝试未阻塞/ping/prewarm；只有所有非 idle 都结束才选择 idle。
  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  if (nonIdlePendingLanes !== NoLanes) {
    // 首选未挂起的新更新。
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes);
    } else {
      // 无新更新时重试已收到 ping 的挂起工作。
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
      if (nonIdlePingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      } else {
        // 仍无 ping 时，若没有待提交成品，选择尚未尝试的 siblings 做 prewarm。
        if (!rootHasPendingCommit) {
          const lanesToPrewarm = nonIdlePendingLanes & ~warmLanes;
          if (lanesToPrewarm !== NoLanes) {
            nextLanes = getHighestPriorityLanes(lanesToPrewarm);
          }
        }
      }
    }
  } else {
    // 只剩 Idle。TODO：Idle 当前几乎未使用，且 speculative render 策略已演进，可评估暂时移除。

    // idle 同样先选未挂起更新。
    const unblockedLanes = pendingLanes & ~suspendedLanes;
    if (unblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(unblockedLanes);
    } else {
      // 无新更新时选择已 ping 工作。
      if (pingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(pingedLanes);
      } else {
        // 无 ping 时选择尚未 prewarm 的工作。
        if (!rootHasPendingCommit) {
          const lanesToPrewarm = pendingLanes & ~warmLanes;
          if (lanesToPrewarm !== NoLanes) {
            nextLanes = getHighestPriorityLanes(lanesToPrewarm);
          }
        }
      }
    }
  }

  if (nextLanes === NoLanes) {
    // 仅所有候选都挂起时可达；TODO：若同时没有 fallback timer，考虑报告警告。
    return NoLanes;
  }

  // 切换 Lanes 会丢弃现有 render 进度，只允许真正更高优先级工作中断。
  if (
    wipLanes !== NoLanes &&
    wipLanes !== nextLanes &&
    // 当前 render 已因延迟挂起时无需保留进度，可直接切换。
    (wipLanes & suspendedLanes) === NoLanes
  ) {
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (
      // 位越向左优先级越低，因此数值不小表示 next 不比 wip 更紧急。
      nextLane >= wipLane ||
      // Default 不打断 transition；两者主要差别是 Default 不支持 refresh transition。
      (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)
    ) {
      // 保留现有候选树继续工作。
      return wipLanes;
    }
  }

  return nextLanes;
}

/**
 * 为强制同步批次选择所有“不低于给定阈值”的未阻塞 Lanes。
 * popstate 等 transition 可借此同步完成；hydration 必须单独成批，结果加入 SyncLane 表示整批按同步处理。
 */
export function getNextLanesToFlushSync(
  root: FiberRoot,
  extraLanesToForceSync: Lane | Lanes,
): Lanes {
  // popstate 更新即使属于 transition 也同步 flush；同时纳入真正 Sync 更新，但关闭该批 View Transition，
  // 避免浏览器完成 scroll restoration 前同步启动动画。
  const lanesToFlush = SyncUpdateLanes | extraLanesToForceSync;

  // 根无待处理工作时直接退出。
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;

  // 移除仍挂起且未收到 ping 的 Lanes。
  const unblockedLanes = pendingLanes & ~(suspendedLanes & ~pingedLanes);
  const unblockedLanesWithMatchingPriority =
    unblockedLanes & getLanesOfEqualOrHigherPriority(lanesToFlush);

  // hydration 与普通 update 不得混批；命中时只返回 hydration 集合并标成 SyncHydration。
  if (unblockedLanesWithMatchingPriority & HydrationLanes) {
    return (
      (unblockedLanesWithMatchingPriority & HydrationLanes) | SyncHydrationLane
    );
  }

  if (unblockedLanesWithMatchingPriority) {
    // 即使没有实际 Sync 更新也加入 SyncLane，明确整批 render/commit 按同步优先级执行。
    return unblockedLanesWithMatchingPriority | SyncLane;
  }

  return NoLanes;
}

/** 判断 renderLanes 是否只是在对所有未阻塞工作都无交集的挂起树做 pre-render。 */
export function checkIfRootIsPrerendering(
  root: FiberRoot,
  renderLanes: Lanes,
): boolean {
  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  // 移除仍挂起且未收到 ping 的 Lanes。
  const unblockedLanes = pendingLanes & ~(suspendedLanes & ~pingedLanes);

  // render 集合没有任何未挂起或已 ping Lane，说明这是 speculative pre-render。
  return (unblockedLanes & renderLanes) === 0;
}

/**
 * 读取 renderLanes 在 root.entanglements 中已登记的关联，并加入同一批。
 * 仅扫描输入集合中已标为 entangled 的位，不递归重扫刚加入的位；登记阶段负责传播已有关系。
 * 纠缠通常表达“同一来源只展示最新一致状态”；根选择先判断是否保留已有 render，再应用这里的关联。
 */
export function getEntangledLanes(root: FiberRoot, renderLanes: Lanes): Lanes {
  let entangledLanes = renderLanes;

  if ((entangledLanes & InputContinuousLane) !== NoLanes) {
    // 当前表达式只保留集合内已有的 DefaultLane，不会加入尚未选中的 Default；后续纠缠扩展由 root.entanglements 决定。
    entangledLanes |= entangledLanes & DefaultLane;
  }

  // 纠缠在 partial-work 中断判断之后应用，所以 interleaved event 新增的纠缠不会丢弃已完成进度。
  // TODO：这可能让中间态更晚才到最终一致态；语义必须强一致的纠缠应确保应用时没有 partial work。
  const allEntangledLanes = root.entangledLanes;
  if (allEntangledLanes !== NoLanes) {
    const entanglements = root.entanglements;
    let lanes = entangledLanes & allEntangledLanes;
    while (lanes > 0) {
      const index = pickArbitraryLaneIndex(lanes);
      const lane = 1 << index;

      entangledLanes |= entanglements[index];

      lanes &= ~lane;
    }
  }

  return entangledLanes;
}

/** 根据 Lane 类别计算饥饿期限；NoTimestamp 表示该类别永不过期。 */
function computeExpirationTime(lane: Lane, currentTime: number) {
  switch (lane) {
    case SyncHydrationLane:
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
    case GestureLane:
      // 用户交互使用与 Scheduler 对应的较短期限；曾放宽后 WWW 指标退化，说明连续同步更新确会造成饥饿，
      // expiration 是兜底而不是正常排序机制。
      return currentTime + syncLaneExpirationMs;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
      return currentTime + transitionLaneExpirationMs;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      // TODO：CPU-bound retry 理应过期，但启用后曾造成浏览器崩溃指标上升且无可复现用例；由开关保护。
      return enableRetryLaneExpiration
        ? currentTime + retryLaneExpirationMs
        : NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
    case DeferredLane:
      // idle 及更低优先级工作不因等待时间升级。
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      return NoTimestamp;
  }
}

/**
 * 为可运行 pending Lanes 建立过期时间，并把已超时项写入 root.expiredLanes。
 * 仍挂起且未 ping 的 Lane 不计 CPU 饥饿；retry 默认排除，避免解包未缓存 Promise 时失去时间切片。
 */
export function markStarvedLanesAsExpired(
  root: FiberRoot,
  currentTime: number,
): void {
  // TODO：每次 yield 都会扫描，可在 root 缓存最早 expiration 以快速退出。

  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes = root.expirationTimes;

  // 逐 pending Lane 检查期限，超时即强制完成。TODO：评估以 upgradePendingLanesToSync 替代，并补 retry 排除测试。
  let lanes = enableRetryLaneExpiration
    ? pendingLanes
    : pendingLanes & ~RetryLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const expirationTime = expirationTimes[index];
    if (expirationTime === NoTimestamp) {
      // 尚无期限且未挂起或已 ping，视为 CPU-bound，从当前单调时间开始计时。
      if (
        (lane & suspendedLanes) === NoLanes ||
        (lane & pingedLanes) !== NoLanes
      ) {
        // 时间戳必须单调递增。
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      // 期限已到，后续选择不得继续让步。
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}

/** 忽略 suspended/ping 状态，直接返回 root.pendingLanes 的最高优先级组。 */
export function getHighestPriorityPendingLanes(root: FiberRoot): Lanes {
  return getHighestPriorityLanes(root.pendingLanes);
}

/** 错误后选择可同步重试的全部非 Offscreen 工作；已禁用恢复的原尝试集合返回空。 */
export function getLanesToRetrySynchronouslyOnError(
  root: FiberRoot,
  originallyAttemptedLanes: Lanes,
): Lanes {
  if (root.errorRecoveryDisabledLanes & originallyAttemptedLanes) {
    // 这些 Lanes 清理前禁止再次进入错误恢复循环。
    return NoLanes;
  }

  const everythingButOffscreen = root.pendingLanes & ~OffscreenLane;
  if (everythingButOffscreen !== NoLanes) {
    return everythingButOffscreen;
  }
  if (everythingButOffscreen & OffscreenLane) {
    return OffscreenLane;
  }
  return NoLanes;
}

/** 判断集合是否含 Sync 或 SyncHydration。 */
export function includesSyncLane(lanes: Lanes): boolean {
  return (lanes & (SyncLane | SyncHydrationLane)) !== NoLanes;
}

/** 判断集合是否含任意非 idle 工作。 */
export function includesNonIdleWork(lanes: Lanes): boolean {
  return (lanes & NonIdleLanes) !== NoLanes;
}
/** 判断集合中的每一位是否都属于 Suspense retry 池。 */
export function includesOnlyRetries(lanes: Lanes): boolean {
  return (lanes & RetryLanes) === lanes;
}
/** 判断集合是否完全不含同步、连续、Default 或 Gesture 等紧急更新。 */
export function includesOnlyNonUrgentLanes(lanes: Lanes): boolean {
  // TODO：该 helper 只由 updateDeferredValueImpl 使用，需复核 hydration 是否也应视为紧急。
  const UrgentLanes =
    SyncLane | InputContinuousLane | DefaultLane | GestureLane;
  return (lanes & UrgentLanes) === NoLanes;
}
/** 判断集合中的每一位是否都属于 transition 池。 */
export function includesOnlyTransitions(lanes: Lanes): boolean {
  return (lanes & TransitionLanes) === lanes;
}

/** 判断集合是否含任意 transition Lane。 */
export function includesTransitionLane(lanes: Lanes): boolean {
  return (lanes & TransitionLanes) !== NoLanes;
}

/** 判断集合是否含任意 Suspense retry Lane。 */
export function includesRetryLane(lanes: Lanes): boolean {
  return (lanes & RetryLanes) !== NoLanes;
}

/** 判断集合是否含 selective/idle hydration、Idle、Offscreen 或 Deferred 尾部工作。 */
export function includesIdleGroupLanes(lanes: Lanes): boolean {
  return (
    (lanes &
      (SelectiveHydrationLane |
        IdleHydrationLane |
        IdleLane |
        OffscreenLane |
        DeferredLane)) !==
    NoLanes
  );
}

/** 判断集合中的每一位是否都属于 hydration。 */
export function includesOnlyHydrationLanes(lanes: Lanes): boolean {
  return (lanes & HydrationLanes) === lanes;
}

/** 判断集合是否为空或只含 Offscreen 标记位。 */
export function includesOnlyOffscreenLanes(lanes: Lanes): boolean {
  return (lanes & OffscreenLane) === lanes;
}

/** 判断集合是否为空或只含 hydration/Offscreen。 */
export function includesOnlyHydrationOrOffscreenLanes(lanes: Lanes): boolean {
  return (lanes & (HydrationLanes | OffscreenLane)) === lanes;
}

/** 判断全部 Lanes 是否允许参与浏览器 View Transition。 */
export function includesOnlyViewTransitionEligibleLanes(lanes: Lanes): boolean {
  return (lanes & (TransitionLanes | RetryLanes | IdleLane)) === lanes;
}

/** 判断全部 Lanes 是否允许因 suspensey resource 暂停 commit。 */
export function includesOnlySuspenseyCommitEligibleLanes(
  lanes: Lanes,
): boolean {
  return (
    (lanes & (TransitionLanes | RetryLanes | IdleLane | GestureLane)) === lanes
  );
}

/** 判断集合是否含会触发默认 loading indicator 的 Sync/Default 工作。 */
export function includesLoadingIndicatorLanes(lanes: Lanes): boolean {
  return (lanes & (SyncLane | DefaultLane)) !== NoLanes;
}

/** 判断集合是否含会阻塞当前交互的同步、连续、Default、hydration 或 Gesture 工作。 */
export function includesBlockingLane(lanes: Lanes): boolean {
  const SyncDefaultLanes =
    SyncHydrationLane |
    SyncLane |
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane |
    GestureLane;
  return (lanes & SyncDefaultLanes) !== NoLanes;
}

/** 判断本次 render 集合是否与 root.expiredLanes 相交；包含开始前或 render 期间过期的 Lane。 */
export function includesExpiredLane(root: FiberRoot, lanes: Lanes): boolean {
  // 必须与 includesBlockingLane 分开：Lane 可能在 render 开始后才过期。
  return (lanes & root.expiredLanes) !== NoLanes;
}

/** 判断单 Lane 是否属于阻塞交互的同步/默认组。 */
export function isBlockingLane(lane: Lane): boolean {
  const SyncDefaultLanes =
    SyncHydrationLane |
    SyncLane |
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane |
    GestureLane;
  return (lane & SyncDefaultLanes) !== NoLanes;
}

/** 判断单 Lane 是否属于 transition 池。 */
export function isTransitionLane(lane: Lane): boolean {
  return (lane & TransitionLanes) !== NoLanes;
}

/** 判断当前 render 是否是开关允许且只含 GestureLane 的手势 transition。 */
export function isGestureRender(lanes: Lanes): boolean {
  if (!enableGestureTransition) {
    return false;
  }
  // 手势 render 不与其他 Lane 混批。
  return lanes === GestureLane;
}

/** 轮转领取下一个普通 transition update Lane，池尾后回到第一个槽。 */
export function claimNextTransitionUpdateLane(): Lane {
  // 在池耗尽前尽量让不同 transition 拥有独立 Lane；之后循环复用。
  const lane = nextTransitionUpdateLane;
  nextTransitionUpdateLane <<= 1;
  if ((nextTransitionUpdateLane & TransitionUpdateLanes) === NoLanes) {
    nextTransitionUpdateLane = TransitionLane1;
  }
  return lane;
}

/** 轮转领取下一个 deferred transition Lane，池尾后回到第一个 deferred 槽。 */
export function claimNextTransitionDeferredLane(): Lane {
  const lane = nextTransitionDeferredLane;
  nextTransitionDeferredLane <<= 1;
  if ((nextTransitionDeferredLane & TransitionDeferredLanes) === NoLanes) {
    nextTransitionDeferredLane = TransitionLane11;
  }
  return lane;
}

/** 轮转领取下一个 Suspense retry Lane，池尾后回到第一个槽。 */
export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane;
  nextRetryLane <<= 1;
  if ((nextRetryLane & RetryLanes) === NoLanes) {
    nextRetryLane = RetryLane1;
  }
  return lane;
}

/** 取 bitmask 最右侧的最低有效位，即数值编码中最高优先级 Lane。 */
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

/** 生成从最高优先级到给定集合最低优先级位的连续 mask。 */
function getLanesOfEqualOrHigherPriority(lanes: Lane | Lanes): Lanes {
  // 取最左命中位及其右侧全部位：0b100/0b101 都生成 0b111。
  const lowestPriorityLaneIndex = 31 - clz32(lanes);
  return (1 << (lowestPriorityLaneIndex + 1)) - 1;
}

/** 从非空集合任选一位；调用算法不依赖具体选择，当前用最低成本的最高优先级位。 */
export function pickArbitraryLane(lanes: Lanes): Lane {
  // 该薄包装会内联，名字用于表达“任选”而非优先级语义。
  return getHighestPriorityLane(lanes);
}

/** 返回集合中任一 Lane 的 LaneMap 索引；当前选择最高位以减少操作。 */
function pickArbitraryLaneIndex(lanes: Lanes) {
  return 31 - clz32(lanes);
}

/** 把单 Lane one-hot 值转换成 LaneMap 下标。 */
function laneToIndex(lane: Lane) {
  return pickArbitraryLaneIndex(lane);
}

/** 判断两个 Lane 集合是否有交集。 */
export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane): boolean {
  return (a & b) !== NoLanes;
}

/** 判断 subset 的每一位是否都包含在 set 中。 */
export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane): boolean {
  return (set & subset) === subset;
}

/** 返回两个 Lane 集合的并集。 */
export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b;
}

/** 从 set 清除 subset 中出现的全部位。 */
export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}

/** 返回两个 Lane 集合的交集。 */
export function intersectLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a & b;
}

/** 运行时保持同一位值，只把更新使用的 Lane 类型提升为 flush 使用的 Lanes 集合类型。 */
export function laneToLanes(lane: Lane): Lanes {
  return lane;
}

/** a 非零且数值小于 b 时返回 a，否则返回 b；调用方应提供有效的 b，b 为 NoLane 时仍返回零。 */
export function higherPriorityLane(a: Lane, b: Lane): Lane {
  // 位越向左数值越大、优先级越低。
  return a !== NoLane && a < b ? a : b;
}

/** 创建无 holes 的 31 项 LaneMap，并让每项初始指向给定值。 */
export function createLaneMap<T>(initial: T): LaneMap<T> {
  // 故意逐项 push，避免 holey array 降级元素种类。
  // https://v8.dev/blog/elements-kinds#avoid-creating-holes
  const laneMap = [];
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(initial);
  }
  return laneMap;
}

/**
 * 把 updateLane 加入 root.pendingLanes，并让非 idle 新更新重新尝试此前挂起的工作。
 * 新更新可能解除 transition 阻塞，因此清空 suspended/pinged/warm；Idle 不可能先于普通工作解锁它们。
 */
export function markRootUpdated(root: FiberRoot, updateLane: Lane) {
  root.pendingLanes |= updateLane;
  if (enableDefaultTransitionIndicator) {
    // transition 更新可能需要显示默认 loading indicator。
    root.indicatorLanes |= updateLane & TransitionLanes;
  }

  // TODO：理论上只需解除 updated Fiber subtree/return 路径覆盖的 suspended Lanes，
  // 可避免无关 sibling 重试；当前根级清空更保守。
  if (updateLane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
    root.warmLanes = NoLanes;
  }
}

/**
 * 记录一次 render 尝试挂起，并清除对应 ping/expiration。
 * 完整遍历过全树时标为 warm；提前 unwind 则保留冷状态，允许后续 prewarm siblings。
 */
export function markRootSuspended(
  root: FiberRoot,
  suspendedLanes: Lanes,
  spawnedLane: Lane,
  didAttemptEntireTree: boolean,
) {
  // TODO：区分“render 尝试结束”与“进行中挂起”两种调用语义，拆为独立函数。
  root.suspendedLanes |= suspendedLanes;
  root.pingedLanes &= ~suspendedLanes;

  if (didAttemptEntireTree) {
    // 全树已尝试，标为 warm 表示没有未探索 sibling。
    root.warmLanes |= suspendedLanes;
  } else {
    // 尚有 sibling 未尝试，不标 warm，使调度器安排 prewarm render。
  }

  // 等待外部数据的 Lanes 不再是 CPU-bound，清除饥饿期限。
  const expirationTimes = root.expirationTimes;
  let lanes = suspendedLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    expirationTimes[index] = NoTimestamp;

    lanes &= ~lane;
  }

  if (spawnedLane !== NoLane) {
    markSpawnedDeferredLane(root, spawnedLane, suspendedLanes);
  }
}

/** 只把当前确实 suspended 的已解决 Lanes 标为 pinged，并使其可再次 prewarm。 */
export function markRootPinged(root: FiberRoot, pingedLanes: Lanes) {
  root.pingedLanes |= root.suspendedLanes & pingedLanes;
  // 新数据可能解锁更多 children，清除 warm 后允许再次探索。
  root.warmLanes &= ~pingedLanes;
}

/**
 * 在成功 render/commit 边界把 root Lane 状态推进到 remainingLanes。
 *
 * 清除已完成 Lane 的纠缠、期限与 hidden update 标记；重置本轮 suspended/pinged/warm；
 * 对新建但仍挂起的 retry Lanes 直接进入 prerender 状态，避免重复普通 unwind。
 */
export function markRootFinished(
  root: FiberRoot,
  finishedLanes: Lanes,
  remainingLanes: Lanes,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
) {
  const previouslyPendingLanes = root.pendingLanes;
  const noLongerPendingLanes = previouslyPendingLanes & ~remainingLanes;

  root.pendingLanes = remainingLanes;

  // remaining 工作从新的已提交树重新尝试。
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;
  root.warmLanes = NoLanes;

  if (enableDefaultTransitionIndicator) {
    root.indicatorLanes &= remainingLanes;
  }

  root.expiredLanes &= remainingLanes;

  root.entangledLanes &= remainingLanes;

  root.errorRecoveryDisabledLanes &= remainingLanes;
  root.shellSuspendCounter = 0;

  const entanglements = root.entanglements;
  const expirationTimes = root.expirationTimes;
  const hiddenUpdates = root.hiddenUpdates;

  // 逐项清除已无 pending 工作的 LaneMap 状态。
  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    entanglements[index] = NoLanes;
    expirationTimes[index] = NoTimestamp;

    const hiddenUpdatesForLane = hiddenUpdates[index];
    if (hiddenUpdatesForLane !== null) {
      hiddenUpdates[index] = null;
      // 该原始 Lane 已从 pending 移除；清掉其 hidden update 的 Offscreen 标记，后续重放按普通 update 判断资格。
      for (let i = 0; i < hiddenUpdatesForLane.length; i++) {
        const update = hiddenUpdatesForLane[i];
        // $FlowFixMe[invalid-compare]
        if (update !== null) {
          update.lane &= ~OffscreenLane;
        }
      }
    }

    lanes &= ~lane;
  }

  if (spawnedLane !== NoLane) {
    markSpawnedDeferredLane(
      root,
      spawnedLane,
      // 父 render 成功且未挂起，派生任务无需再与父 Lanes 纠缠。
      NoLanes,
    );
  }

  // suspendedRetryLanes 是本轮新 Suspense 边界产生且之后未 ping 的 retry。fallback 提交后可再次尝试，
  // 但已知仍挂起，所以直接进入“遇到挂起也继续 siblings”的 prerender，而非普通快速 unwind。
  if (
    suspendedRetryLanes !== NoLanes &&
    // 只在 render 期间没有新 update 时成立；markRootUpdated 会清空 suspended/pinged 状态。
    updatedLanes === NoLanes &&
    !(disableLegacyMode && root.tag === LegacyRoot)
  ) {
    // 不能把本轮开始前已 pending 且未参与尝试的 retry 误标成“本轮已挂起”。
    const freshlySpawnedRetryLanes =
      suspendedRetryLanes &
      // 排除本轮前已 pending、且不在 finishedLanes 的 retry。
      ~(previouslyPendingLanes & ~finishedLanes);
    root.suspendedLanes |= freshlySpawnedRetryLanes;
  }
}

/**
 * 登记 render 派生的 deferred Lane，并与 DeferredLane 及父更新 Lanes 纠缠。
 * 该标记防止 useDeferredValue 层层继续 defer，只允许第一层形成派生任务。
 */
function markSpawnedDeferredLane(
  root: FiberRoot,
  spawnedLane: Lane,
  entangledLanes: Lanes,
) {
  // 派生任务进入 pending，并从 suspended 中移除以允许首次尝试。
  root.pendingLanes |= spawnedLane;
  root.suspendedLanes &= ~spawnedLane;

  // TODO：已有 TransitionDeferredLanes 后理论上可移除特殊 DeferredLane；但 Offscreen 仍把专用位
  // 当作魔法值，需要先引入并迁移 OffscreenDeferredLane 才能统一。
  const spawnedLaneIndex = laneToIndex(spawnedLane);
  root.entangledLanes |= spawnedLane;
  root.entanglements[spawnedLaneIndex] |=
    DeferredLane |
    // 父 render 若挂起，派生任务必须包含相同 update Lanes；Offscreen 等非 update 位无需传播。
    (entangledLanes & UpdateLanes);
}

/**
 * 把给定 Lanes 写入根的纠缠登记，并更新所有已与新组相交的 Lane 表项。
 * 若 C 的表项已包含 A，再登记 A/B 时会把 A/B 加入 C 的表项，防止从 C 开始渲染时漏掉 B。
 * 本次扫描传播的是传入的新组，没有反复求完整图闭包；getEntangledLanes 直接读取这些登记结果。
 */
export function markRootEntangled(root: FiberRoot, entangledLanes: Lanes) {
  // ReactTransition-test.js 中的传递纠缠用例保护下面两个条件，任一缺失都会泄漏中间态。

  const rootEntangledLanes = (root.entangledLanes |= entangledLanes);
  const entanglements = root.entanglements;
  let lanes = rootEntangledLanes;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    if (
      // 当前 Lane 本身属于新纠缠组。
      (lane & entangledLanes) |
      // 或其旧纠缠集合与新组相交，需要扩成传递闭包。
      (entanglements[index] & entangledLanes)
    ) {
      entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}

/** 把多个 pending Lanes 与 SyncLane 纠缠，使下一次选择按单个同步批次完成。 */
export function upgradePendingLanesToSync(
  root: FiberRoot,
  lanesToUpgrade: Lanes,
) {
  // 接受集合并逐位登记到 SyncLane 的纠缠表，成本高于单 Lane 版本。
  root.pendingLanes |= SyncLane;
  root.entangledLanes |= SyncLane;
  let lanes = lanesToUpgrade;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    root.entanglements[SyncLaneIndex] |= lane;
    lanes &= ~lane;
  }
}

/** 按原 Lane 缓存 hidden update，并附加 OffscreenLane 让消费路径识别隐藏来源。 */
export function markHiddenUpdate(
  root: FiberRoot,
  update: ConcurrentUpdate,
  lane: Lane,
) {
  const index = laneToIndex(lane);
  const hiddenUpdates = root.hiddenUpdates;
  const hiddenUpdatesForLane = hiddenUpdates[index];
  if (hiddenUpdatesForLane === null) {
    hiddenUpdates[index] = [update];
  } else {
    hiddenUpdatesForLane.push(update);
  }
  update.lane = lane | OffscreenLane;
}

/**
 * 把当前 render 的最高优先级提升到对应 hydration Lane。
 * 已在该级别挂起或正在 render 表示此前尝试失败，返回 NoLane 让调用方放弃 hydration、改走客户端 render。
 */
export function getBumpedLaneForHydration(
  root: FiberRoot,
  renderLanes: Lanes,
): Lane {
  const renderLane = getHighestPriorityLane(renderLanes);
  const bumpedLane =
    (renderLane & SyncUpdateLanes) !== NoLane
      ? // 同步更新在此统一到 SyncHydration；若下沉到按 Lane helper，会误让其他调用同步 flush。
        // TODO：当前多个同步 Lane 的统一并不自洽，应最终合并成真实单 Lane。
        SyncHydrationLane
      : getBumpedLaneForHydrationByLane(renderLane);
  // 已 suspended 或正在 render 表示该 hydration 级别正在/已经失败。TODO：把“是否放弃”决策移给调用方。
  if ((bumpedLane & (root.suspendedLanes | renderLanes)) !== NoLane) {
    // 放弃认领服务端节点，回退客户端 render。
    return NoLane;
  }
  return bumpedLane;
}

/** 把普通更新 Lane 映射到同优先级 hydration Lane；已是 hydration/不支持提升时返回 NoLane。 */
export function getBumpedLaneForHydrationByLane(lane: Lane): Lane {
  switch (lane) {
    case SyncLane:
      lane = SyncHydrationLane;
      break;
    case InputContinuousLane:
      lane = InputContinuousHydrationLane;
      break;
    case DefaultLane:
      lane = DefaultHydrationLane;
      break;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      lane = TransitionHydrationLane;
      break;
    case IdleLane:
      lane = IdleHydrationLane;
      break;
    default:
      // 其余值已是 hydration Lane，或不允许以 hydration 优先级重试。
      lane = NoLane;
      break;
  }
  return lane;
}

/** 在 DevTools updater tracking 开启时，把 fiber 归因到每个目标 Lane 的 pending 集合。 */
export function addFiberToLanesMap(
  root: FiberRoot,
  fiber: Fiber,
  lanes: Lanes | Lane,
) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    updaters.add(fiber);

    lanes &= ~lane;
  }
}

/**
 * 在新的 render 尝试开始前，把目标 Lanes 的 pending updater Fibers 移入 memoized 集合，并按 alternate 去重。
 * 先消费 pending 槽可区分本轮与之后同 Lane 的更新归因；尝试重启时 WorkLoop 可把归因恢复到 pending。
 */
export function movePendingFibersToMemoized(root: FiberRoot, lanes: Lanes) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  const memoizedUpdaters = root.memoizedUpdaters;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    if (updaters.size > 0) {
      updaters.forEach(fiber => {
        const alternate = fiber.alternate;
        if (alternate === null || !memoizedUpdaters.has(alternate)) {
          memoizedUpdaters.add(fiber);
        }
      });
      updaters.clear();
    }

    lanes &= ~lane;
  }
}

/** transition tracing 开启时，把一次 transition 登记到对应 LaneMap 集合。 */
export function addTransitionToLanesMap(
  root: FiberRoot,
  transition: Transition,
  lane: Lane,
) {
  if (enableTransitionTracing) {
    const transitionLanesMap = root.transitionLanes;
    const index = laneToIndex(lane);
    let transitions = transitionLanesMap[index];
    if (transitions === null) {
      transitions = new Set();
    }
    transitions.add(transition);

    transitionLanesMap[index] = transitions;
  }
}

/** 汇总给定 Lanes 关联的 transitions；开关关闭或无记录时返回 null。 */
export function getTransitionsForLanes(
  root: FiberRoot,
  lanes: Lane | Lanes,
): Array<Transition> | null {
  if (!enableTransitionTracing) {
    return null;
  }

  const transitionsForLanes = [];
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      transitions.forEach(transition => {
        transitionsForLanes.push(transition);
      });
    }

    lanes &= ~lane;
  }

  if (transitionsForLanes.length === 0) {
    return null;
  }

  return transitionsForLanes;
}

/** 清空已完成 Lanes 的 transition tracing 集合。 */
export function clearTransitionsForLanes(root: FiberRoot, lanes: Lane | Lanes) {
  if (!enableTransitionTracing) {
    return;
  }

  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      root.transitionLanes[index] = null;
    }

    lanes &= ~lane;
  }
}

/** 按最高优先级类别返回 Performance Track 分组名。 */
export function getGroupNameOfHighestPriorityLane(lanes: Lanes): string {
  if (
    lanes &
    (SyncHydrationLane |
      SyncLane |
      InputContinuousHydrationLane |
      InputContinuousLane |
      DefaultHydrationLane |
      DefaultLane)
  ) {
    return 'Blocking';
  }
  if (lanes & GestureLane) {
    return 'Gesture';
  }
  if (lanes & (TransitionHydrationLane | TransitionLanes)) {
    return 'Transition';
  }
  if (lanes & RetryLanes) {
    return 'Suspense';
  }
  if (
    lanes &
    (SelectiveHydrationLane |
      IdleHydrationLane |
      IdleLane |
      OffscreenLane |
      DeferredLane)
  ) {
    return 'Idle';
  }
  return 'Other';
}
