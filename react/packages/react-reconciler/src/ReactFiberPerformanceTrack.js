/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable react-internal/no-production-logging */

import type {Fiber} from './ReactInternalTypes';

import type {Lanes} from './ReactFiberLane';

import type {CapturedValue} from './ReactCapturedValue';

import {SuspenseComponent} from './ReactWorkTags';

import getComponentNameFromFiber from './getComponentNameFromFiber';

import {
  getGroupNameOfHighestPriorityLane,
  includesOnlyHydrationLanes,
  includesOnlyOffscreenLanes,
  includesOnlyHydrationOrOffscreenLanes,
  includesSomeLane,
} from './ReactFiberLane';

import {
  addValueToProperties,
  addObjectToProperties,
  addObjectDiffToProperties,
} from 'shared/ReactPerformanceTrackProperties';

import {
  enableProfilerTimer,
  enableGestureTransition,
  enablePerformanceIssueReporting,
} from 'shared/ReactFeatureFlags';

/** 当前环境是否支持 React 性能轨道依赖的 timeStamp/measure API。 */
const supportsUserTiming =
  enableProfilerTimer &&
  typeof console !== 'undefined' &&
  typeof console.timeStamp === 'function' &&
  (!__DEV__ ||
    // 开发模式还要依赖 performance.measure 记录可展开的属性详情。
    (typeof performance !== 'undefined' &&
      // $FlowFixMe[method-unbinding]
      typeof performance.measure === 'function'));

/** React DevTools 时间线中承载组件 render/effect 的轨道名。 */
const COMPONENTS_TRACK = 'Components ⚛';
/** 按 Lane 优先级组织调度阶段的轨道组名。 */
const LANES_TRACK_GROUP = 'Scheduler ⚛';

// 当前调度区间写入的轨道；各 start 入口或 setCurrentTrackFromLanes 在后续 phase 日志前设置。
let currentTrack: string = 'Blocking'; // Lane

/** 根据本轮最高优先级 Lane 选择后续调度标记写入的轨道。 */
export function setCurrentTrackFromLanes(lanes: Lanes): void {
  currentTrack = getGroupNameOfHighestPriorityLane(lanes);
}

/** 以固定优先级顺序预创建所有 Lane 轨道，稳定 DevTools 的纵向排列。 */
export function markAllLanesInOrder() {
  if (supportsUserTiming) {
    // 按优先级顺序预创建轨道。performance.mark 按首次插入排序，measure 却反序；即便
    // 0 时刻已过去，加入一个零长度槽位仍会参与排序。
    console.timeStamp(
      'Blocking Track',
      0.003,
      0.003,
      'Blocking',
      LANES_TRACK_GROUP,
      'primary-light',
    );
    if (enableGestureTransition) {
      console.timeStamp(
        'Gesture Track',
        0.003,
        0.003,
        'Gesture',
        LANES_TRACK_GROUP,
        'primary-light',
      );
    }
    console.timeStamp(
      'Transition Track',
      0.003,
      0.003,
      'Transition',
      LANES_TRACK_GROUP,
      'primary-light',
    );
    console.timeStamp(
      'Suspense Track',
      0.003,
      0.003,
      'Suspense',
      LANES_TRACK_GROUP,
      'primary-light',
    );
    console.timeStamp(
      'Idle Track',
      0.003,
      0.003,
      'Idle',
      LANES_TRACK_GROUP,
      'primary-light',
    );
  }
}

/**
 * 在组件轨道记录 mount/unmount/reconnect/disconnect 的调用方计时区间。
 * startTime/endTime 均为 Scheduler 相对时间的毫秒数，不是 epoch；函数不自行启动计时。
 * 复用 detail/options 后同步调用 measure 并立即 clearMeasures，轨道已收到记录但浏览器
 * PerformanceEntry 缓冲不再持有它；ConsoleTask 只补归因上下文，不异步调度用户工作。
 */
function logComponentTrigger(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  trigger: string,
) {
  if (supportsUserTiming) {
    reusableComponentOptions.start = startTime;
    reusableComponentOptions.end = endTime;
    reusableComponentDevToolDetails.color = 'warning';
    reusableComponentDevToolDetails.tooltipText = trigger;
    reusableComponentDevToolDetails.properties = null;
    const debugTask = fiber._debugTask;
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        performance.measure.bind(
          performance,
          trigger,
          reusableComponentOptions,
        ),
      );
    } else {
      performance.measure(trigger, reusableComponentOptions);
    }
    performance.clearMeasures(trigger);
  }
}

/** 记录组件宿主结构首次挂载的时间区间。 */
export function logComponentMount(
  fiber: Fiber,
  startTime: number,
  endTime: number,
): void {
  logComponentTrigger(fiber, startTime, endTime, 'Mount');
}

/** 记录组件宿主结构卸载的时间区间。 */
export function logComponentUnmount(
  fiber: Fiber,
  startTime: number,
  endTime: number,
): void {
  logComponentTrigger(fiber, startTime, endTime, 'Unmount');
}

/** 记录隐藏 Activity/Offscreen 内容重新连接的时间区间。 */
export function logComponentReappeared(
  fiber: Fiber,
  startTime: number,
  endTime: number,
): void {
  logComponentTrigger(fiber, startTime, endTime, 'Reconnect');
}

/** 记录 Activity/Offscreen 内容断开连接的时间区间。 */
export function logComponentDisappeared(
  fiber: Fiber,
  startTime: number,
  endTime: number,
): void {
  logComponentTrigger(fiber, startTime, endTime, 'Disconnect');
}

let alreadyWarnedForDeepEquality = false;

/** 保存父层“已报告深相等 props”状态，避免同一子树重复性能提示。 */
export function pushDeepEquality(): boolean {
  if (__DEV__) {
    // 为 true 时不在进入 child 时清零；该值表示任一祖先已为本子树报告深相等 props。
    return alreadyWarnedForDeepEquality;
  }
  return false;
}

/** 离开组件子树时恢复父层深相等提示状态。 */
export function popDeepEquality(prev: boolean): void {
  if (__DEV__) {
    alreadyWarnedForDeepEquality = prev;
  }
}

/** 可复用的 DevTools measure.detail，避免每个组件记录都分配新对象。 */
const reusableComponentDevToolDetails = {
  color: 'primary',
  properties: null as null | Array<[string, string]>,
  tooltipText: '',
  track: COMPONENTS_TRACK,
};

/** 包装可复用详情与动态起止时间的 PerformanceMeasureOptions。 */
const reusableComponentOptions: PerformanceMeasureOptions = {
  start: -0,
  end: -0,
  detail: {
    devtools: reusableComponentDevToolDetails,
  },
};

/** props diff 属性列表的固定标题行。 */
const reusableChangedPropsEntry = ['Changed Props', ''];

/** DevTools 对 render/effect 内级联更新给出的结构化性能问题。 */
const reusableCascadingUpdateIssue = {
  name: 'React: Cascading Update',
  severity: 'warning',
  description:
    'A cascading update is an update that is triggered during an ongoing render. This can lead to performance issues.',
  learnMoreUrl:
    'https://react.dev/reference/dev-tools/react-performance-tracks#cascading-updates',
};

/** 深层相等 props 导致昂贵重复渲染时显示的优化建议。 */
const DEEP_EQUALITY_WARNING =
  'This component received deeply equal props. It might benefit from useMemo or the React Compiler in its owner.';

/** 深相等分支复用的 props diff 标题行。 */
const reusableDeeplyEqualPropsEntry = ['Changed Props', DEEP_EQUALITY_WARNING];

/**
 * 记录一次组件 render；生产模式写轻量 timeStamp，开发模式还计算 self time、props diff、
 * 深相等提示，并关联 ConsoleTask 调用栈；级联更新的等待链由 logBlockingStart 另行记录。
 * @param fiber 本次完成树中的组件，actualDuration 包含其渲染子树；若 child 链与 alternate
 * 相同，不减去复用子节点的旧 actualDuration，避免把前轮耗时误当成本轮子耗时。
 * @param wasHydrated 为 hydration 渲染选不同颜色，不改变时间或 Fiber 状态。
 * @param committedLanes 用于判断是否组件自身已调度该轮工作，排除不该提示的深相等重渲染。
 * 深相等提示要求嵌套差异详情、无祖先提示、自身未调度且整棵实际耗时超过 100ms；
 * 阈值不是深相等检查耗时。这里没有对宿主计时 API 抛错作局部捕获。
 */
export function logComponentRender(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  wasHydrated: boolean,
  committedLanes: Lanes,
): void {
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // 无可读组件名时跳过，避免生成无法归因的轨道项。
    return;
  }
  if (supportsUserTiming) {
    const alternate = fiber.alternate;
    let selfTime: number = fiber.actualDuration as any;
    if (alternate === null || alternate.child !== fiber.child) {
      for (let child = fiber.child; child !== null; child = child.sibling) {
        selfTime -= child.actualDuration as any;
      }
    }
    const color =
      selfTime < 0.5
        ? wasHydrated
          ? 'tertiary-light'
          : 'primary-light'
        : selfTime < 10
          ? wasHydrated
            ? 'tertiary'
            : 'primary'
          : selfTime < 100
            ? wasHydrated
              ? 'tertiary-dark'
              : 'primary-dark'
            : 'error';

    if (!__DEV__) {
      console.timeStamp(
        name,
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        color,
      );
    } else {
      const props = fiber.memoizedProps;
      const debugTask = fiber._debugTask;

      if (
        props !== null &&
        alternate !== null &&
        alternate.memoizedProps !== props
      ) {
        // 更新时比较前后 props，并把实际变化项写入 DevTools 属性面板。
        const properties: Array<[string, string]> = [reusableChangedPropsEntry];
        const isDeeplyEqual = addObjectDiffToProperties(
          alternate.memoizedProps,
          props,
          properties,
          0,
        );
        if (properties.length > 1) {
          if (
            isDeeplyEqual &&
            !alreadyWarnedForDeepEquality &&
            !includesSomeLane(alternate.lanes, committedLanes) &&
            (fiber.actualDuration as any) > 100
          ) {
            alreadyWarnedForDeepEquality = true;
            // 这是子树中首个以深相等 props 重渲染、没有自身调度且耗时显著的组件，突出
            // 显示以便排查。只有 properties 含嵌套 diff 时才进入；浅相等不会误报。
            properties[0] = reusableDeeplyEqualPropsEntry;
            reusableComponentDevToolDetails.color = 'warning';
            reusableComponentDevToolDetails.tooltipText = DEEP_EQUALITY_WARNING;
          } else {
            reusableComponentDevToolDetails.color = color;
            reusableComponentDevToolDetails.tooltipText = name;
          }
          reusableComponentDevToolDetails.properties = properties;
          reusableComponentOptions.start = startTime;
          reusableComponentOptions.end = endTime;

          const measureName = '\u200b' + name;
          if (debugTask != null) {
            debugTask.run(
              // $FlowFixMe[method-unbinding]
              performance.measure.bind(
                performance,
                measureName,
                reusableComponentOptions,
              ),
            );
          } else {
            performance.measure(measureName, reusableComponentOptions);
          }
          performance.clearMeasures(measureName);
        } else {
          if (debugTask != null) {
            debugTask.run(
              // $FlowFixMe[method-unbinding]
              console.timeStamp.bind(
                console,
                name,
                startTime,
                endTime,
                COMPONENTS_TRACK,
                undefined,
                color,
              ),
            );
          } else {
            console.timeStamp(
              name,
              startTime,
              endTime,
              COMPONENTS_TRACK,
              undefined,
              color,
            );
          }
        }
      } else {
        if (debugTask != null) {
          debugTask.run(
            // $FlowFixMe[method-unbinding]
            console.timeStamp.bind(
              console,
              name,
              startTime,
              endTime,
              COMPONENTS_TRACK,
              undefined,
              color,
            ),
          );
        } else {
          console.timeStamp(
            name,
            startTime,
            endTime,
            COMPONENTS_TRACK,
            undefined,
            color,
          );
        }
      }
    }
  }
}

/**
 * 记录组件 render 错误；开发模式附带错误、key、props 与实际抛错 Fiber 的 ConsoleTask。
 */
export function logComponentErrored(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  errors: Array<CapturedValue<mixed>>,
): void {
  if (supportsUserTiming) {
    const name = getComponentNameFromFiber(fiber);
    if (name === null) {
      // 无可读组件名时跳过，避免生成无法归因的轨道项。
      return;
    }
    if (__DEV__) {
      let debugTask: ?ConsoleTask = null;
      const properties: Array<[string, string]> = [];
      for (let i = 0; i < errors.length; i++) {
        const capturedValue = errors[i];
        if (debugTask == null && capturedValue.source !== null) {
          // 捕获值带 source Fiber 时使用它的 debugTask，而非 Error Boundary 的栈；失败
          // render 树不会展示，这样仍能定位真正抛错组件。
          // TODO：保存失败 Fiber，并记录包含抛错组件的完整子树。
          debugTask = capturedValue.source._debugTask;
        }
        const error = capturedValue.value;
        const message =
          typeof error === 'object' &&
          error !== null &&
          typeof error.message === 'string'
            ? // eslint-disable-next-line react-internal/safe-string-coercion
              String(error.message)
            : // eslint-disable-next-line react-internal/safe-string-coercion
              String(error);
        properties.push(['Error', message]);
      }
      if (fiber.key !== null) {
        addValueToProperties('key', fiber.key, properties, 0, '');
      }
      if (fiber.memoizedProps !== null) {
        addObjectToProperties(fiber.memoizedProps, properties, 0, '');
      }
      if (debugTask == null) {
        // 捕获值没有 debugTask 时退回 Error Boundary 自身的任务上下文。
        debugTask = fiber._debugTask;
      }
      const options: PerformanceMeasureOptions = {
        start: startTime,
        end: endTime,
        detail: {
          devtools: {
            color: 'error',
            track: COMPONENTS_TRACK,
            tooltipText:
              fiber.tag === SuspenseComponent
                ? 'Hydration failed'
                : 'Error boundary caught an error',
            properties,
          },
        },
      };

      const measureName = '\u200b' + name;
      if (__DEV__ && debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          performance.measure.bind(performance, measureName, options),
        );
      } else {
        performance.measure(measureName, options);
      }
      performance.clearMeasures(measureName);
    } else {
      console.timeStamp(
        name,
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        'error',
      );
    }
  }
}

/** 记录 lifecycle/insertion/layout/passive effect 抛错，并附带错误与组件输入详情。 */
function logComponentEffectErrored(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  errors: Array<CapturedValue<mixed>>,
): void {
  if (supportsUserTiming) {
    const name = getComponentNameFromFiber(fiber);
    if (name === null) {
      // 无可读组件名时跳过，避免生成无法归因的轨道项。
      return;
    }
    if (__DEV__) {
      const properties: Array<[string, string]> = [];
      for (let i = 0; i < errors.length; i++) {
        const capturedValue = errors[i];
        const error = capturedValue.value;
        const message =
          typeof error === 'object' &&
          error !== null &&
          typeof error.message === 'string'
            ? // eslint-disable-next-line react-internal/safe-string-coercion
              String(error.message)
            : // eslint-disable-next-line react-internal/safe-string-coercion
              String(error);
        properties.push(['Error', message]);
      }
      if (fiber.key !== null) {
        addValueToProperties('key', fiber.key, properties, 0, '');
      }
      if (fiber.memoizedProps !== null) {
        addObjectToProperties(fiber.memoizedProps, properties, 0, '');
      }
      const options = {
        start: startTime,
        end: endTime,
        detail: {
          devtools: {
            color: 'error',
            track: COMPONENTS_TRACK,
            tooltipText: 'A lifecycle or effect errored',
            properties,
          },
        },
      };
      const debugTask = fiber._debugTask;
      const measureName = '\u200b' + name;
      if (debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          performance.measure.bind(performance, measureName, options),
        );
      } else {
        // $FlowFixMe[incompatible-type]
        performance.measure(measureName, options);
      }
      performance.clearMeasures(measureName);
    } else {
      console.timeStamp(
        name,
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        'error',
      );
    }
  }
}

/** 按 selfTime（毫秒，调用方扣除子组件后的 effect 自耗时）着色记录区间；起止时间仍覆盖调用方整段测量。errors 非 null 时改用错误详情，不在此执行 effect 或捕获新错误。 */
export function logComponentEffect(
  fiber: Fiber,
  startTime: number,
  endTime: number,
  selfTime: number,
  errors: null | Array<CapturedValue<mixed>>,
): void {
  if (errors !== null) {
    logComponentEffectErrored(fiber, startTime, endTime, errors);
    return;
  }
  const name = getComponentNameFromFiber(fiber);
  if (name === null) {
    // 无可读组件名时跳过，避免生成无法归因的轨道项。
    return;
  }
  if (supportsUserTiming) {
    const color =
      selfTime < 1
        ? 'secondary-light'
        : selfTime < 100
          ? 'secondary'
          : selfTime < 500
            ? 'secondary-dark'
            : 'error';
    const debugTask = fiber._debugTask;
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          name,
          startTime,
          endTime,
          COMPONENTS_TRACK,
          undefined,
          color,
        ),
      );
    } else {
      console.timeStamp(
        name,
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        color,
      );
    }
  }
}

/** 记录 React 让出到恢复之间的等待区间，以 Blocked 标记并按间隔毫秒数着色；不把这段等待计为 React 自身 CPU 执行耗时。短于 3ms 的间隔不记录。 */
export function logYieldTime(startTime: number, endTime: number): void {
  if (supportsUserTiming) {
    const yieldDuration = endTime - startTime;
    if (yieldDuration < 3) {
      // 跳过不足 3ms 的高频短 yield，它们对性能诊断价值很低。
      return;
    }
    // CPU 阻塞可能影响交互，按持续时间逐级加深颜色。
    const color =
      yieldDuration < 5
        ? 'primary-light'
        : yieldDuration < 10
          ? 'primary'
          : yieldDuration < 100
            ? 'primary-dark'
            : 'error';
    // 若最终未 commit，此项会孤立留在 Components 轨道，但仍可解释 render 为何饥饿。
    // TODO：先入队，只在对应 render commit 后写入。
    console.timeStamp(
      'Blocked',
      startTime,
      endTime,
      COMPONENTS_TRACK,
      undefined,
      color,
    );
  }
}

/** 记录因 Suspense thenable 而让出执行权的区间，并关联挂起 Fiber 的任务栈。 */
export function logSuspendedYieldTime(
  startTime: number,
  endTime: number,
  suspendedFiber: Fiber,
): void {
  if (supportsUserTiming) {
    const debugTask = suspendedFiber._debugTask;
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Suspended',
          startTime,
          endTime,
          COMPONENTS_TRACK,
          undefined,
          'primary-light',
        ),
      );
    } else {
      console.timeStamp(
        'Suspended',
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        'primary-light',
      );
    }
  }
}

/** 记录 Transition Action 等待异步结果而让出执行权的区间。 */
export function logActionYieldTime(
  startTime: number,
  endTime: number,
  suspendedFiber: Fiber,
): void {
  if (supportsUserTiming) {
    const debugTask = suspendedFiber._debugTask;
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Action',
          startTime,
          endTime,
          COMPONENTS_TRACK,
          undefined,
          'primary-light',
        ),
      );
    } else {
      console.timeStamp(
        'Action',
        startTime,
        endTime,
        COMPONENTS_TRACK,
        undefined,
        'primary-light',
      );
    }
  }
}

/**
 * 记录同步/阻塞更新从事件、setState 到 render 的等待链；识别连续事件、Promise ping 与
 * render/effect 内派生的 cascading update，并把后者上报为性能问题。
 * updateTime 是记录更新入口的时间，eventTime 是宿主事件关联时间，renderStartTime 是根
 * 开始本轮渲染的时间，均为可比较的相对毫秒数；缺失或逆序值被夹到 event≤update≤render。
 * eventIsRepeat/isSpawnedUpdate/isPingedUpdate 由计时模块提供，本函数不从区间长度推导来源。
 * lanes 只选 hydration/offscreen 配色，debugTask 与更新方法/组件名用于 DEV 归因。
 */
export function logBlockingStart(
  updateTime: number,
  eventTime: number,
  eventType: null | string,
  eventIsRepeat: boolean,
  isSpawnedUpdate: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask, // 仅开发环境使用
  updateMethodName: null | string,
  updateComponentName: null | string,
): void {
  if (supportsUserTiming) {
    currentTrack = 'Blocking';
    // 把缺失或晚于 render 的时间戳夹到合法单调区间。
    if (updateTime > 0) {
      if (updateTime > renderStartTime) {
        updateTime = renderStartTime;
      }
    } else {
      updateTime = renderStartTime;
    }
    if (eventTime > 0) {
      if (eventTime > updateTime) {
        eventTime = updateTime;
      }
    } else {
      eventTime = updateTime;
    }
    // render/effect 内派生的阻塞更新属于级联 render；同一事件内第二次阻塞更新通常意味着
    // 多次 flushSync 或 microtask 中 setState，也视作级联迹象。
    if (eventType !== null && updateTime > eventTime) {
      // 标出浏览器事件 timeStamp 到调用 setState 之间的应用侧耗时。
      const color = eventIsRepeat ? 'secondary-light' : 'warning';
      if (__DEV__ && debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          console.timeStamp.bind(
            console,
            eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
            eventTime,
            updateTime,
            currentTrack,
            LANES_TRACK_GROUP,
            color,
          ),
        );
      } else {
        console.timeStamp(
          eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
          eventTime,
          updateTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        );
      }
    }
    if (renderStartTime > updateTime) {
      // 标出调用 setState 到 React 开始 render 之间的排队/阻塞时间。
      const color = isSpawnedUpdate
        ? 'error'
        : includesOnlyHydrationOrOffscreenLanes(lanes)
          ? 'tertiary-light'
          : 'primary-light';
      const label = isPingedUpdate
        ? 'Promise Resolved'
        : isSpawnedUpdate
          ? 'Cascading Update'
          : renderStartTime - updateTime > 5
            ? 'Update Blocked'
            : 'Update';

      if (__DEV__) {
        const properties = [];
        if (updateComponentName != null) {
          properties.push(['Component name', updateComponentName]);
        }
        if (updateMethodName != null) {
          properties.push(['Method name', updateMethodName]);
        }
        const measureOptions = {
          start: updateTime,
          end: renderStartTime,
          detail: {
            devtools: {
              properties,
              track: currentTrack,
              trackGroup: LANES_TRACK_GROUP,
              color,
            },
          },
        };
        if (enablePerformanceIssueReporting && isSpawnedUpdate) {
          // $FlowFixMe[prop-missing] - detail is untyped
          measureOptions.detail.devtools.performanceIssue =
            reusableCascadingUpdateIssue;
        }

        if (debugTask) {
          debugTask.run(
            // $FlowFixMe[method-unbinding]
            performance.measure.bind(performance, label, measureOptions),
          );
        } else {
          // $FlowFixMe[incompatible-type]
          performance.measure(label, measureOptions);
        }
        performance.clearMeasures(label);
      } else {
        console.timeStamp(
          label,
          updateTime,
          renderStartTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        );
      }
    }
  }
}

/** 记录 gesture 更新从输入事件、状态更新到 render 启动的两段等待，并选择 Gesture 轨道。 */
export function logGestureStart(
  updateTime: number,
  eventTime: number,
  eventType: null | string,
  eventIsRepeat: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  debugTask: null | ConsoleTask, // 仅开发环境使用
  updateMethodName: null | string,
  updateComponentName: null | string,
): void {
  if (supportsUserTiming) {
    currentTrack = 'Gesture';
    // 把缺失或晚于 render 的时间戳夹到合法单调区间。
    if (updateTime > 0) {
      if (updateTime > renderStartTime) {
        updateTime = renderStartTime;
      }
    } else {
      updateTime = renderStartTime;
    }
    if (eventTime > 0) {
      if (eventTime > updateTime) {
        eventTime = updateTime;
      }
    } else {
      eventTime = updateTime;
    }

    if (updateTime > eventTime && eventType !== null) {
      // 标出输入事件 timeStamp 到 gesture 更新发起之间的应用侧耗时。
      const color = eventIsRepeat ? 'secondary-light' : 'warning';
      if (__DEV__ && debugTask) {
        debugTask.run(
          console.timeStamp.bind(
            console,
            eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
            eventTime,
            updateTime,
            currentTrack,
            LANES_TRACK_GROUP,
            color,
          ),
        );
      } else {
        console.timeStamp(
          eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
          eventTime,
          updateTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        );
      }
    }
    if (renderStartTime > updateTime) {
      // 标出状态更新到 gesture render 启动之间的排队/阻塞时间。
      const label = isPingedUpdate
        ? 'Promise Resolved'
        : renderStartTime - updateTime > 5
          ? 'Gesture Blocked'
          : 'Gesture';
      if (__DEV__) {
        const properties = [];
        if (updateComponentName != null) {
          properties.push(['Component name', updateComponentName]);
        }
        if (updateMethodName != null) {
          properties.push(['Method name', updateMethodName]);
        }
        const measureOptions = {
          start: updateTime,
          end: renderStartTime,
          detail: {
            devtools: {
              properties,
              track: currentTrack,
              trackGroup: LANES_TRACK_GROUP,
              color: 'primary-light',
            },
          },
        };

        if (debugTask) {
          debugTask.run(
            // $FlowFixMe[method-unbinding]
            performance.measure.bind(performance, label, measureOptions),
          );
        } else {
          // $FlowFixMe[incompatible-type]
          performance.measure(label, measureOptions);
        }
        performance.clearMeasures(label);
      } else {
        console.timeStamp(
          label,
          updateTime,
          renderStartTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'primary-light',
        );
      }
    }
  }
}

/**
 * 记录 Transition 从输入事件、startTransition、异步 Action、setState 到 render 的完整等待链。
 * startTime 是 Transition 启动时间，updateTime 是实际更新时间；两者间标 Action 只是
 * 调用方已记录区间的展示，不在这里等待或解析 Promise。缺失/逆序值夹到
 * event≤start≤update≤render，原参数是局部数值，不回写根的计时记录。
 */
export function logTransitionStart(
  startTime: number,
  updateTime: number,
  eventTime: number,
  eventType: null | string,
  eventIsRepeat: boolean,
  isPingedUpdate: boolean,
  renderStartTime: number,
  debugTask: null | ConsoleTask, // 仅开发环境使用
  updateMethodName: null | string,
  updateComponentName: null | string,
): void {
  if (supportsUserTiming) {
    currentTrack = 'Transition';
    // 把缺失或逆序时间戳夹到 event≤start≤update≤render 的单调区间。
    if (updateTime > 0) {
      if (updateTime > renderStartTime) {
        updateTime = renderStartTime;
      }
    } else {
      updateTime = renderStartTime;
    }
    if (startTime > 0) {
      if (startTime > updateTime) {
        startTime = updateTime;
      }
    } else {
      startTime = updateTime;
    }
    if (eventTime > 0) {
      if (eventTime > startTime) {
        eventTime = startTime;
      }
    } else {
      eventTime = startTime;
    }

    if (startTime > eventTime && eventType !== null) {
      // 标出输入事件 timeStamp 到 startTransition 之间的应用侧耗时。
      const color = eventIsRepeat ? 'secondary-light' : 'warning';
      if (__DEV__ && debugTask) {
        debugTask.run(
          console.timeStamp.bind(
            console,
            eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
            eventTime,
            startTime,
            currentTrack,
            LANES_TRACK_GROUP,
            color,
          ),
        );
      } else {
        console.timeStamp(
          eventIsRepeat ? 'Consecutive' : 'Event: ' + eventType,
          eventTime,
          startTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        );
      }
    }
    if (updateTime > startTime) {
      // 标出异步 Transition Action 启动到 setState/render 之间的等待。
      // TODO：优先关联 startTransition 调用点自己的 debugTask。
      if (__DEV__ && debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          console.timeStamp.bind(
            console,
            'Action',
            startTime,
            updateTime,
            currentTrack,
            LANES_TRACK_GROUP,
            'primary-dark',
          ),
        );
      } else {
        console.timeStamp(
          'Action',
          startTime,
          updateTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'primary-dark',
        );
      }
    }
    if (renderStartTime > updateTime) {
      // 标出状态更新到 Transition render 启动之间的排队/阻塞时间。
      const label = isPingedUpdate
        ? 'Promise Resolved'
        : renderStartTime - updateTime > 5
          ? 'Update Blocked'
          : 'Update';
      if (__DEV__) {
        const properties = [];
        if (updateComponentName != null) {
          properties.push(['Component name', updateComponentName]);
        }
        if (updateMethodName != null) {
          properties.push(['Method name', updateMethodName]);
        }
        const measureOptions = {
          start: updateTime,
          end: renderStartTime,
          detail: {
            devtools: {
              properties,
              track: currentTrack,
              trackGroup: LANES_TRACK_GROUP,
              color: 'primary-light',
            },
          },
        };

        if (debugTask) {
          debugTask.run(
            // $FlowFixMe[method-unbinding]
            performance.measure.bind(performance, label, measureOptions),
          );
        } else {
          // $FlowFixMe[incompatible-type]
          performance.measure(label, measureOptions);
        }
        performance.clearMeasures(label);
      } else {
        console.timeStamp(
          label,
          updateTime,
          renderStartTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'primary-light',
        );
      }
    }
  }
}

/** 按 Lane 类型标记一次完成的 render 阶段（普通、hydration 或 Offscreen prepare）。 */
export function logRenderPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    const color = includesOnlyHydrationOrOffscreenLanes(lanes)
      ? 'tertiary-dark'
      : 'primary-dark';
    const label = includesOnlyOffscreenLanes(lanes)
      ? 'Prepared'
      : includesOnlyHydrationLanes(lanes)
        ? 'Hydrated'
        : 'Render';
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          label,
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        ),
      );
    } else {
      console.timeStamp(
        label,
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        color,
      );
    }
  }
}

/** 标记被更高优先级工作打断的 render/prewarm/hydration 区间。 */
export function logInterruptedRenderPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    const color = includesOnlyHydrationOrOffscreenLanes(lanes)
      ? 'tertiary-dark'
      : 'primary-dark';
    const label = includesOnlyOffscreenLanes(lanes)
      ? 'Prewarm'
      : includesOnlyHydrationLanes(lanes)
        ? 'Interrupted Hydration'
        : 'Interrupted Render';
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          label,
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        ),
      );
    } else {
      console.timeStamp(
        label,
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        color,
      );
    }
  }
}

/** 标记本轮 render 因 Suspense 挂起后用于预热 sibling 的区间。 */
export function logSuspendedRenderPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    const color = includesOnlyHydrationOrOffscreenLanes(lanes)
      ? 'tertiary-dark'
      : 'primary-dark';
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Prewarm',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        ),
      );
    } else {
      console.timeStamp(
        'Prewarm',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        color,
      );
    }
  }
}

/** 标记 render 已挂起且必须等待解除后才能 commit 的区间。 */
export function logSuspendedWithDelayPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask,
): void {
  // 此状态表示 render 已挂起，解除阻塞前不能 commit。
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    const color = includesOnlyHydrationOrOffscreenLanes(lanes)
      ? 'tertiary-dark'
      : 'primary-dark';
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Suspended',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          color,
        ),
      );
    } else {
      console.timeStamp(
        'Suspended',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        color,
      );
    }
  }
}

/** 记录从可恢复错误重新 render 的区间，并附带 hydration 失败与错误详情。 */
export function logRecoveredRenderPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  recoverableErrors: Array<CapturedValue<mixed>>,
  hydrationFailed: boolean,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__) {
      const properties: Array<[string, string]> = [];
      for (let i = 0; i < recoverableErrors.length; i++) {
        const capturedValue = recoverableErrors[i];
        const error = capturedValue.value;
        const message =
          typeof error === 'object' &&
          error !== null &&
          typeof error.message === 'string'
            ? // eslint-disable-next-line react-internal/safe-string-coercion
              String(error.message)
            : // eslint-disable-next-line react-internal/safe-string-coercion
              String(error);
        properties.push(['Recoverable Error', message]);
      }
      const options: PerformanceMeasureOptions = {
        start: startTime,
        end: endTime,
        detail: {
          devtools: {
            color: 'primary-dark',
            track: currentTrack,
            trackGroup: LANES_TRACK_GROUP,
            tooltipText: hydrationFailed
              ? 'Hydration Failed'
              : 'Recovered after Error',
            properties,
          },
        },
      };
      if (debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          performance.measure.bind(performance, 'Recovered', options),
        );
      } else {
        performance.measure('Recovered', options);
      }
      performance.clearMeasures('Recovered');
    } else {
      console.timeStamp(
        'Recovered',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'error',
      );
    }
  }
}

/** 标记最终以错误结束、未恢复成功的 render 区间。 */
export function logErroredRenderPhase(
  startTime: number,
  endTime: number,
  lanes: Lanes,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Errored',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'error',
        ),
      );
    } else {
      console.timeStamp(
        'Errored',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'error',
      );
    }
  }
}

/** 标记外部可变源等导致前后读取不一致（tearing）的 render 区间。 */
export function logInconsistentRender(
  startTime: number,
  endTime: number,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Teared Render',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'error',
        ),
      );
    } else {
      console.timeStamp(
        'Teared Render',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'error',
      );
    }
  }
}

/** 标记 commit 等待 CSS、图片等宿主资源就绪的区间。 */
export function logSuspendedCommitPhase(
  startTime: number,
  endTime: number,
  reason: string,
  debugTask: null | ConsoleTask,
): void {
  // 此状态表示 commit 正等待 CSS、图片等资源。
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    // TODO：附上导致挂起的具体原因与资源 URL。
    // TODO：区分等待 ViewTransition 导致的 Suspended。
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          reason,
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-light',
        ),
      );
    } else {
      console.timeStamp(
        reason,
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-light',
      );
    }
  }
}

/** 标记宿主 ViewTransition 启动前等待资源或其他前置条件的区间。 */
export function logSuspendedViewTransitionPhase(
  startTime: number,
  endTime: number,
  reason: string,
  debugTask: null | ConsoleTask,
): void {
  // 此状态通常表示 ViewTransition 前的 commit 正等待 CSS、图片等资源。
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    // TODO：附上导致挂起的具体原因与资源 URL。
    // TODO：进一步区分资源等待与 ViewTransition 自身等待。
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          reason,
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-light',
        ),
      );
    } else {
      console.timeStamp(
        reason,
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-light',
      );
    }
  }
}

/** 记录 mutation/layout/passive commit 抛错，并在开发模式附上错误属性。 */
export function logCommitErrored(
  startTime: number,
  endTime: number,
  errors: Array<CapturedValue<mixed>>,
  passive: boolean,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__) {
      const properties: Array<[string, string]> = [];
      for (let i = 0; i < errors.length; i++) {
        const capturedValue = errors[i];
        const error = capturedValue.value;
        const message =
          typeof error === 'object' &&
          error !== null &&
          typeof error.message === 'string'
            ? // eslint-disable-next-line react-internal/safe-string-coercion
              String(error.message)
            : // eslint-disable-next-line react-internal/safe-string-coercion
              String(error);
        properties.push(['Error', message]);
      }
      const options: PerformanceMeasureOptions = {
        start: startTime,
        end: endTime,
        detail: {
          devtools: {
            color: 'error',
            track: currentTrack,
            trackGroup: LANES_TRACK_GROUP,
            tooltipText: passive
              ? 'Remaining Effects Errored'
              : 'Commit Errored',
            properties,
          },
        },
      };
      if (debugTask) {
        debugTask.run(
          // $FlowFixMe[method-unbinding]
          performance.measure.bind(performance, 'Errored', options),
        );
      } else {
        performance.measure('Errored', options);
      }
      performance.clearMeasures('Errored');
    } else {
      console.timeStamp(
        'Errored',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'error',
      );
    }
  }
}

/** 记录主 commit 区间；若有捕获错误则转入错误记录，并标明是否中断 ViewTransition。 */
export function logCommitPhase(
  startTime: number,
  endTime: number,
  errors: null | Array<CapturedValue<mixed>>,
  abortedViewTransition: boolean,
  debugTask: null | ConsoleTask,
): void {
  if (errors !== null) {
    logCommitErrored(startTime, endTime, errors, false, debugTask);
    return;
  }
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          abortedViewTransition
            ? 'Commit Interrupted View Transition'
            : 'Commit',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          abortedViewTransition ? 'error' : 'secondary-dark',
        ),
      );
    } else {
      console.timeStamp(
        abortedViewTransition ? 'Commit Interrupted View Transition' : 'Commit',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        abortedViewTransition ? 'error' : 'secondary-dark',
      );
    }
  }
}

/** 记录 commit 后等待浏览器 paint 或下一阶段继续执行的让出区间。 */
export function logPaintYieldPhase(
  startTime: number,
  endTime: number,
  delayedUntilPaint: boolean,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          delayedUntilPaint ? 'Waiting for Paint' : 'Waiting',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-light',
        ),
      );
    } else {
      console.timeStamp(
        delayedUntilPaint ? 'Waiting for Paint' : 'Waiting',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-light',
      );
    }
  }
}

/** 标记为反向 gesture 构造 ghost/clone 树的提交阶段。 */
export function logApplyGesturePhase(
  startTime: number,
  endTime: number,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Create Ghost Tree',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-dark',
        ),
      );
    } else {
      console.timeStamp(
        'Create Ghost Tree',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-dark',
      );
    }
  }
}

/** 标记调用宿主 ViewTransition 到动画真正启动之间的等待或中断区间。 */
export function logStartViewTransitionYieldPhase(
  startTime: number,
  endTime: number,
  abortedViewTransition: boolean,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          abortedViewTransition
            ? 'Interrupted View Transition'
            : 'Starting Animation',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          abortedViewTransition ? 'error' : 'secondary-light',
        ),
      );
    } else {
      console.timeStamp(
        abortedViewTransition
          ? 'Interrupted View Transition'
          : 'Starting Animation',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        abortedViewTransition ? ' error' : 'secondary-light',
      );
    }
  }
}

/** 标记宿主 ViewTransition 动画实际运行的时间区间。 */
export function logAnimatingPhase(
  startTime: number,
  endTime: number,
  debugTask: null | ConsoleTask,
): void {
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Animating',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-dark',
        ),
      );
    } else {
      console.timeStamp(
        'Animating',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-dark',
      );
    }
  }
}

/** 记录剩余 passive effect 提交；若有错误则复用 passive 错误轨道。 */
export function logPassiveCommitPhase(
  startTime: number,
  endTime: number,
  errors: null | Array<CapturedValue<mixed>>,
  debugTask: null | ConsoleTask,
): void {
  if (errors !== null) {
    logCommitErrored(startTime, endTime, errors, true, debugTask);
    return;
  }
  if (supportsUserTiming) {
    if (endTime <= startTime) {
      return;
    }
    if (__DEV__ && debugTask) {
      debugTask.run(
        // $FlowFixMe[method-unbinding]
        console.timeStamp.bind(
          console,
          'Remaining Effects',
          startTime,
          endTime,
          currentTrack,
          LANES_TRACK_GROUP,
          'secondary-dark',
        ),
      );
    } else {
      console.timeStamp(
        'Remaining Effects',
        startTime,
        endTime,
        currentTrack,
        LANES_TRACK_GROUP,
        'secondary-dark',
      );
    }
  }
}
