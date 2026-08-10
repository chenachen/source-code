/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ViewTransitionProps,
  ProfilerProps,
  ProfilerPhase,
} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks';
import type {HookFlags} from './ReactHookEffectTags';
import type {FragmentInstanceType} from './ReactFiberConfig';
import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';

import {getViewTransitionName} from './ReactFiberViewTransitionComponent';

import {
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableSchedulingProfiler,
  enableViewTransition,
  enableFragmentRefs,
} from 'shared/ReactFeatureFlags';
import {
  ClassComponent,
  Fragment,
  HostComponent,
  HostHoistable,
  HostSingleton,
  ViewTransitionComponent,
} from './ReactWorkTags';
import {NoFlags} from './ReactFiberFlags';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {resolveClassComponentProps} from './ReactFiberClassComponent';
import {
  recordEffectDuration,
  startEffectTimer,
  isCurrentUpdateNested,
} from './ReactProfilerTimer';
import {NoMode, ProfileMode} from './ReactTypeOfMode';
import {
  commitCallbacks,
  commitHiddenCallbacks,
} from './ReactFiberClassUpdateQueue';
import {
  getPublicInstance,
  createViewTransitionInstance,
  createFragmentInstance,
} from './ReactFiberConfig';
import {
  captureCommitPhaseError,
  setIsRunningInsertionEffect,
} from './ReactFiberWorkLoop';
import {
  NoFlags as NoHookEffect,
  Layout as HookLayout,
  Insertion as HookInsertion,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {didWarnAboutReassigningProps} from './ReactFiberBeginWork';
import {
  markComponentPassiveEffectMountStarted,
  markComponentPassiveEffectMountStopped,
  markComponentPassiveEffectUnmountStarted,
  markComponentPassiveEffectUnmountStopped,
  markComponentLayoutEffectMountStarted,
  markComponentLayoutEffectMountStopped,
  markComponentLayoutEffectUnmountStarted,
  markComponentLayoutEffectUnmountStopped,
} from './ReactFiberDevToolsHook';
import {
  callComponentDidMountInDEV,
  callComponentDidUpdateInDEV,
  callComponentWillUnmountInDEV,
  callCreateInDEV,
  callDestroyInDEV,
} from './ReactFiberCallUserSpace';

import {runWithFiberInDEV} from './ReactCurrentFiber';

/** 当前 Fiber 是否同时启用 Profiler 计时与 commit hook 耗时采集。 */
function shouldProfile(current: Fiber): boolean {
  return (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    (current.mode & ProfileMode) !== NoMode
  );
}

/**
 * 挂载符合 hookFlags 的 layout effect；mutation 阶段已先销毁旧 effect，确保所有 destroy
 * 先于任何 create，避免 sibling 的 cleanup 覆盖另一 sibling 新设置的 ref。
 */
export function commitHookLayoutEffects(
  finishedWork: Fiber,
  hookFlags: HookFlags,
) {
  // mutation 阶段已销毁旧 layout effect，确保 sibling 间 destroy/create 不互相覆盖 ref。
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListMount(hookFlags, finishedWork);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListMount(hookFlags, finishedWork);
  }
}

/**
 * 在 mutation 阶段销毁匹配的 layout effect；所有 Fiber 的 destroy 均先于 layout 阶段
 * create，隔离同次提交中 sibling effect 的可见副作用。
 */
export function commitHookLayoutUnmountEffects(
  finishedWork: Fiber,
  nearestMountedAncestor: null | Fiber,
  hookFlags: HookFlags,
) {
  // mutation 阶段先销毁全部 layout effect，再运行任何 create，避免 sibling 相互干扰。
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListUnmount(
      hookFlags,
      finishedWork,
      nearestMountedAncestor,
    );
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListUnmount(
      hookFlags,
      finishedWork,
      nearestMountedAncestor,
    );
  }
}

/**
 * 遍历函数组件循环 Effect 链并执行匹配 flags 的 create。
 * 保存 destroy、维护 insertion-effect 执行标记与 Scheduling Profiler，非法返回值在 DEV
 * 给出 Hook 定位；单个 effect 抛错由提交阶段错误边界捕获。
 */
export function commitHookEffectListMount(
  flags: HookFlags,
  finishedWork: Fiber,
) {
  try {
    const updateQueue: FunctionComponentUpdateQueue | null =
      finishedWork.updateQueue as any;
    const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
    if (lastEffect !== null) {
      const firstEffect = lastEffect.next;
      let effect = firstEffect;
      do {
        if ((effect.tag & flags) === flags) {
          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectMountStarted(finishedWork);
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectMountStarted(finishedWork);
            }
          }

          // 挂载 effect 并保存 cleanup。
          let destroy;
          if (__DEV__) {
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(true);
            }
            destroy = runWithFiberInDEV(finishedWork, callCreateInDEV, effect);
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(false);
            }
          } else {
            const create = effect.create;
            const inst = effect.inst;
            destroy = create();
            inst.destroy = destroy;
          }

          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectMountStopped();
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectMountStopped();
            }
          }

          if (__DEV__) {
            if (destroy !== undefined && typeof destroy !== 'function') {
              let hookName;
              if ((effect.tag & HookLayout) !== NoFlags) {
                hookName = 'useLayoutEffect';
              } else if ((effect.tag & HookInsertion) !== NoFlags) {
                hookName = 'useInsertionEffect';
              } else {
                hookName = 'useEffect';
              }
              let addendum;
              // $FlowFixMe[invalid-compare]
              if (destroy === null) {
                addendum =
                  ' You returned null. If your effect does not require clean ' +
                  'up, return undefined (or nothing).';
                // $FlowFixMe[incompatible-type] (@poteto) this check is safe on arbitrary non-null/void objects
              } else if (typeof destroy.then === 'function') {
                addendum =
                  '\n\nIt looks like you wrote ' +
                  hookName +
                  '(async () => ...) or returned a Promise. ' +
                  'Instead, write the async function inside your effect ' +
                  'and call it immediately:\n\n' +
                  hookName +
                  '(() => {\n' +
                  '  async function fetchData() {\n' +
                  '    // You can await here\n' +
                  '    const response = await MyAPI.getData(someId);\n' +
                  '    // ...\n' +
                  '  }\n' +
                  '  fetchData();\n' +
                  `}, [someId]); // Or [] if effect doesn't need props or state\n\n` +
                  'Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching';
              } else {
                // $FlowFixMe[unsafe-addition] (@poteto)
                addendum = ' You returned: ' + destroy;
              }
              runWithFiberInDEV(
                finishedWork,
                (n, a) => {
                  console.error(
                    '%s must not return anything besides a function, ' +
                      'which is used for clean-up.%s',
                    n,
                    a,
                  );
                },
                hookName,
                addendum,
              );
            }
          }
        }
        effect = effect.next;
      } while (effect !== firstEffect);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/**
 * 遍历循环 Effect 链，清空并执行匹配 flags 的 destroy。
 * 先置空 inst.destroy 防止重复调用，insertion effect 期间同步维护执行标记，异常不会中断
 * 其余提交卸载流程。
 */
export function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  try {
    const updateQueue: FunctionComponentUpdateQueue | null =
      finishedWork.updateQueue as any;
    const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
    if (lastEffect !== null) {
      const firstEffect = lastEffect.next;
      let effect = firstEffect;
      do {
        if ((effect.tag & flags) === flags) {
          // 卸载 effect。
          const inst = effect.inst;
          const destroy = inst.destroy;
          if (destroy !== undefined) {
            inst.destroy = undefined;
            if (enableSchedulingProfiler) {
              if ((flags & HookPassive) !== NoHookEffect) {
                markComponentPassiveEffectUnmountStarted(finishedWork);
              } else if ((flags & HookLayout) !== NoHookEffect) {
                markComponentLayoutEffectUnmountStarted(finishedWork);
              }
            }

            if (__DEV__) {
              if ((flags & HookInsertion) !== NoHookEffect) {
                setIsRunningInsertionEffect(true);
              }
            }
            safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);
            if (__DEV__) {
              if ((flags & HookInsertion) !== NoHookEffect) {
                setIsRunningInsertionEffect(false);
              }
            }

            if (enableSchedulingProfiler) {
              if ((flags & HookPassive) !== NoHookEffect) {
                markComponentPassiveEffectUnmountStopped();
              } else if ((flags & HookLayout) !== NoHookEffect) {
                markComponentLayoutEffectUnmountStopped();
              }
            }
          }
        }
        effect = effect.next;
      } while (effect !== firstEffect);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 挂载匹配的 passive effect，并在 Profiler 开启时计入当前 Fiber effectDuration。 */
export function commitHookPassiveMountEffects(
  finishedWork: Fiber,
  hookFlags: HookFlags,
) {
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListMount(hookFlags, finishedWork);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListMount(hookFlags, finishedWork);
  }
}

/** 销毁匹配的 passive effect，并在 Profiler 开启时计入当前 Fiber effectDuration。 */
export function commitHookPassiveUnmountEffects(
  finishedWork: Fiber,
  nearestMountedAncestor: null | Fiber,
  hookFlags: HookFlags,
) {
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListUnmount(
      hookFlags,
      finishedWork,
      nearestMountedAncestor,
    );
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListUnmount(
      hookFlags,
      finishedWork,
      nearestMountedAncestor,
    );
  }
}

/**
 * 在 layout 阶段调用类组件 componentDidMount 或 componentDidUpdate。
 * 更新分支解析旧 defaultProps 并传入 snapshot；DEV 校验实例公开字段未被用户重写，
 * Profiler 路径记录生命周期耗时，异常统一交给提交阶段错误捕获。
 */
export function commitClassLayoutLifecycles(
  finishedWork: Fiber,
  current: Fiber | null,
) {
  const instance = finishedWork.stateNode;
  if (current === null) {
    // 依赖最近渲染已写入实例 props/state。TODO：实现恢复渲染时重新评估是否应在此更新。
    if (__DEV__) {
      if (
        !finishedWork.type.defaultProps &&
        !('ref' in finishedWork.memoizedProps) &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'componentDidMount. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'componentDidMount. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    if (shouldProfile(finishedWork)) {
      startEffectTimer();
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          callComponentDidMountInDEV,
          finishedWork,
          instance,
        );
      } else {
        try {
          instance.componentDidMount();
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }
      recordEffectDuration(finishedWork);
    } else {
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          callComponentDidMountInDEV,
          finishedWork,
          instance,
        );
      } else {
        try {
          instance.componentDidMount();
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }
    }
  } else {
    const prevProps = resolveClassComponentProps(
      finishedWork.type,
      current.memoizedProps,
    );
    const prevState = current.memoizedState;
    // 依赖最近渲染已写入实例 props/state。TODO：实现恢复渲染时重新评估是否应在此更新。
    if (__DEV__) {
      if (
        !finishedWork.type.defaultProps &&
        !('ref' in finishedWork.memoizedProps) &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'componentDidUpdate. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'componentDidUpdate. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    if (shouldProfile(finishedWork)) {
      startEffectTimer();
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          callComponentDidUpdateInDEV,
          finishedWork,
          instance,
          prevProps,
          prevState,
          instance.__reactInternalSnapshotBeforeUpdate,
        );
      } else {
        try {
          instance.componentDidUpdate(
            prevProps,
            prevState,
            instance.__reactInternalSnapshotBeforeUpdate,
          );
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }
      recordEffectDuration(finishedWork);
    } else {
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          callComponentDidUpdateInDEV,
          finishedWork,
          instance,
          prevProps,
          prevState,
          instance.__reactInternalSnapshotBeforeUpdate,
        );
      } else {
        try {
          instance.componentDidUpdate(
            prevProps,
            prevState,
            instance.__reactInternalSnapshotBeforeUpdate,
          );
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }
    }
  }
}

/**
 * Offscreen 重连等特殊路径专用的 componentDidMount 调用器；跳过常规 mount/update 分派。
 */
export function commitClassDidMount(finishedWork: Fiber) {
  // TODO：检查 LayoutStatic 标记，进一步收窄调用条件。
  const instance = finishedWork.stateNode;
  if (typeof instance.componentDidMount === 'function') {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        callComponentDidMountInDEV,
        finishedWork,
        instance,
      );
    } else {
      try {
        instance.componentDidMount();
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
}

/**
 * 冲刷类组件 UpdateQueue 中本次可见提交的 setState/forceUpdate callbacks。
 * callback 的 this 指向实例；DEV 在调用前校验实例 props/state 与 Fiber memoized 值一致。
 */
export function commitClassCallbacks(finishedWork: Fiber) {
  // TODO：到提交阶段队列可能已保证非空，可评估移除类型检查。
  const updateQueue: UpdateQueue<mixed> | null =
    finishedWork.updateQueue as any;
  if (updateQueue !== null) {
    const instance = finishedWork.stateNode;
    if (__DEV__) {
      if (
        !finishedWork.type.defaultProps &&
        !('ref' in finishedWork.memoizedProps) &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'processing the update queue. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'processing the update queue. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    // 依赖最近渲染已写入实例 props/state。TODO：实现恢复渲染时重新评估是否应在此更新。
    try {
      if (__DEV__) {
        runWithFiberInDEV(finishedWork, commitCallbacks, updateQueue, instance);
      } else {
        commitCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

/** Offscreen 子树重新可见时，补执行隐藏期间被延迟的类更新 callbacks。 */
export function commitClassHiddenCallbacks(finishedWork: Fiber) {
  const updateQueue: UpdateQueue<mixed> | null =
    finishedWork.updateQueue as any;
  if (updateQueue !== null) {
    const instance = finishedWork.stateNode;
    try {
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          commitHiddenCallbacks,
          updateQueue,
          instance,
        );
      } else {
        commitHiddenCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

/**
 * 冲刷 HostRoot UpdateQueue callbacks，并以首个宿主/类 child 的公开实例作为 this。
 */
export function commitRootCallbacks(finishedWork: Fiber) {
  // TODO：到提交阶段队列可能已保证非空，可评估移除类型检查。
  const updateQueue: UpdateQueue<mixed> | null =
    finishedWork.updateQueue as any;
  if (updateQueue !== null) {
    let instance = null;
    if (finishedWork.child !== null) {
      switch (finishedWork.child.tag) {
        case HostSingleton:
        case HostComponent:
          instance = getPublicInstance(finishedWork.child.stateNode);
          break;
        case ClassComponent:
          instance = finishedWork.child.stateNode;
          break;
      }
    }
    try {
      if (__DEV__) {
        runWithFiberInDEV(finishedWork, commitCallbacks, updateQueue, instance);
      } else {
        commitCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<mixed> | null = null;
if (__DEV__) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set();
}

/** 用稳定签名调用类实例 getSnapshotBeforeUpdate，供 DEV Fiber 上下文包装复用。 */
function callGetSnapshotBeforeUpdates(
  instance: any,
  prevProps: any,
  prevState: any,
) {
  return instance.getSnapshotBeforeUpdate(prevProps, prevState);
}

/**
 * before-mutation 阶段调用 getSnapshotBeforeUpdate，并把返回值暂存在类实例，供随后的
 * componentDidUpdate 使用。旧 props 会补 defaultProps；undefined snapshot 在 DEV 警告。
 */
export function commitClassSnapshot(finishedWork: Fiber, current: Fiber) {
  const prevProps = current.memoizedProps;
  const prevState = current.memoizedState;
  const instance = finishedWork.stateNode;
  // 依赖最近渲染已写入实例 props/state。TODO：实现恢复渲染时重新评估是否应在此更新。
  if (__DEV__) {
    if (
      !finishedWork.type.defaultProps &&
      !('ref' in finishedWork.memoizedProps) &&
      !didWarnAboutReassigningProps
    ) {
      if (instance.props !== finishedWork.memoizedProps) {
        console.error(
          'Expected %s props to match memoized props before ' +
            'getSnapshotBeforeUpdate. ' +
            'This might either be because of a bug in React, or because ' +
            'a component reassigns its own `this.props`. ' +
            'Please file an issue.',
          getComponentNameFromFiber(finishedWork) || 'instance',
        );
      }
      if (instance.state !== finishedWork.memoizedState) {
        console.error(
          'Expected %s state to match memoized state before ' +
            'getSnapshotBeforeUpdate. ' +
            'This might either be because of a bug in React, or because ' +
            'a component reassigns its own `this.state`. ' +
            'Please file an issue.',
          getComponentNameFromFiber(finishedWork) || 'instance',
        );
      }
    }
  }
  try {
    const resolvedPrevProps = resolveClassComponentProps(
      finishedWork.type,
      prevProps,
    );
    let snapshot;
    if (__DEV__) {
      snapshot = runWithFiberInDEV(
        finishedWork,
        callGetSnapshotBeforeUpdates,
        instance,
        resolvedPrevProps,
        prevState,
      );
      const didWarnSet =
        didWarnAboutUndefinedSnapshotBeforeUpdate as any as Set<mixed>;
      if (snapshot === undefined && !didWarnSet.has(finishedWork.type)) {
        didWarnSet.add(finishedWork.type);
        runWithFiberInDEV(finishedWork, () => {
          console.error(
            '%s.getSnapshotBeforeUpdate(): A snapshot value (or null) ' +
              'must be returned. You have returned undefined.',
            getComponentNameFromFiber(finishedWork),
          );
        });
      }
    } else {
      snapshot = callGetSnapshotBeforeUpdates(
        instance,
        resolvedPrevProps,
        prevState,
      );
    }
    instance.__reactInternalSnapshotBeforeUpdate = snapshot;
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/**
 * 安全调用 componentWillUnmount：先把实例字段恢复为 current 值，再捕获错误，保证单个
 * 卸载生命周期不会中断其余子树清理；Profiler 开启时记录其耗时。
 */
export function safelyCallComponentWillUnmount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: any,
) {
  instance.props = resolveClassComponentProps(
    current.type,
    current.memoizedProps,
  );
  instance.state = current.memoizedState;
  if (shouldProfile(current)) {
    startEffectTimer();
    if (__DEV__) {
      runWithFiberInDEV(
        current,
        callComponentWillUnmountInDEV,
        current,
        nearestMountedAncestor,
        instance,
      );
    } else {
      try {
        instance.componentWillUnmount();
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
    }
    recordEffectDuration(current);
  } else {
    if (__DEV__) {
      runWithFiberInDEV(
        current,
        callComponentWillUnmountInDEV,
        current,
        nearestMountedAncestor,
        instance,
      );
    } else {
      try {
        instance.componentWillUnmount();
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
    }
  }
}

/**
 * 解析 Fiber 对应公开实例并附加 ref。
 * ViewTransition/Fragment 按需创建专用公开包装；函数 ref 的返回值保存为 refCleanup，
 * 对象 ref 写入 current，非法旧式 ref 仅在 DEV 警告。
 */
function commitAttachRef(finishedWork: Fiber) {
  const ref = finishedWork.ref;
  if (ref !== null) {
    let instanceToUse;
    switch (finishedWork.tag) {
      case HostHoistable:
      case HostSingleton:
      case HostComponent:
        instanceToUse = getPublicInstance(finishedWork.stateNode);
        break;
      case ViewTransitionComponent: {
        if (enableViewTransition) {
          const instance: ViewTransitionState = finishedWork.stateNode;
          const props: ViewTransitionProps = finishedWork.memoizedProps;
          const name = getViewTransitionName(props, instance);
          if (instance.ref === null || instance.ref.name !== name) {
            instance.ref = createViewTransitionInstance(name);
          }
          instanceToUse = instance.ref;
          break;
        }
        instanceToUse = finishedWork.stateNode;
        break;
      }
      case Fragment:
        if (enableFragmentRefs) {
          const instance: null | FragmentInstanceType = finishedWork.stateNode;
          if (instance === null) {
            finishedWork.stateNode = createFragmentInstance(finishedWork);
          }
          instanceToUse = finishedWork.stateNode;
          break;
        }
      // 功能关闭时落入默认实例路径。
      default:
        instanceToUse = finishedWork.stateNode;
    }
    if (typeof ref === 'function') {
      if (shouldProfile(finishedWork)) {
        try {
          startEffectTimer();
          finishedWork.refCleanup = ref(instanceToUse);
        } finally {
          recordEffectDuration(finishedWork);
        }
      } else {
        finishedWork.refCleanup = ref(instanceToUse);
      }
    } else {
      if (__DEV__) {
        // TODO：把 ref 形状警告前移到渲染阶段 markRef。
        if (typeof ref === 'string') {
          console.error('String refs are no longer supported.');
        } else if (!ref.hasOwnProperty('current')) {
          console.error(
            'Unexpected ref object provided for %s. ' +
              'Use either a ref-setter function or React.createRef().',
            getComponentNameFromFiber(finishedWork),
          );
        }
      }

      // $FlowFixMe[incompatible-use] unable to narrow type to the non-function case
      ref.current = instanceToUse;
    }
  }
}

/** 捕获附加 ref 的错误，避免一个用户 ref 中断其余挂载提交。 */
export function safelyAttachRef(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(current, commitAttachRef, current);
    } else {
      commitAttachRef(current);
    }
  } catch (error) {
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

/**
 * 安全分离函数/对象 ref：优先调用 refCleanup，否则以 null 调用函数 ref 或清空 current。
 * cleanup 执行后同时清空 current/alternate 引用，防止后续路径重复调用。
 */
export function safelyDetachRef(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  const ref = current.ref;
  const refCleanup = current.refCleanup;

  if (ref !== null) {
    if (typeof refCleanup === 'function') {
      try {
        if (shouldProfile(current)) {
          try {
            startEffectTimer();
            if (__DEV__) {
              runWithFiberInDEV(current, refCleanup);
            } else {
              refCleanup();
            }
          } finally {
            recordEffectDuration(current);
          }
        } else {
          if (__DEV__) {
            runWithFiberInDEV(current, refCleanup);
          } else {
            refCleanup();
          }
        }
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      } finally {
        // refCleanup 已调用；清空双方引用以防重复执行。
        current.refCleanup = null;
        const finishedWork = current.alternate;
        if (finishedWork != null) {
          finishedWork.refCleanup = null;
        }
      }
    } else if (typeof ref === 'function') {
      try {
        if (shouldProfile(current)) {
          try {
            startEffectTimer();
            if (__DEV__) {
              runWithFiberInDEV(current, ref, null) as void;
            } else {
              ref(null);
            }
          } finally {
            recordEffectDuration(current);
          }
        } else {
          if (__DEV__) {
            runWithFiberInDEV(current, ref, null) as void;
          } else {
            ref(null);
          }
        }
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
    } else {
      // $FlowFixMe[incompatible-use] unable to narrow type to RefObject
      ref.current = null;
    }
  }
}

/**
 * 安全调用 Hook cleanup；CRUD effect 可先绑定 resource，DEV 用当前 Fiber 包装用户代码，
 * 生产则直接捕获并上报提交阶段错误。
 */
function safelyCallDestroy(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  destroy: (() => void) | (({...}) => void),
  resource?: {...} | void | null,
) {
  // $FlowFixMe[extra-arg] @poteto this is safe either way because the extra arg is ignored if it's not a CRUD effect
  const destroy_ = resource == null ? destroy : destroy.bind(null, resource);
  if (__DEV__) {
    runWithFiberInDEV(
      current,
      callDestroyInDEV,
      current,
      nearestMountedAncestor,
      destroy_,
    );
  } else {
    try {
      // $FlowFixMe[incompatible-type](incompatible-call) Already bound to resource
      destroy_();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
}

/**
 * 调用 Profiler onRender，并在启用 commit hooks 时调用 onCommit。
 * phase 区分 mount、update 与由提交 effect 触发的 nested-update。
 */
function commitProfiler(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  effectDuration: number,
) {
  const {id, onCommit, onRender} = finishedWork.memoizedProps as ProfilerProps;

  let phase: ProfilerPhase = current === null ? 'mount' : 'update';
  if (enableProfilerNestedUpdatePhase) {
    if (isCurrentUpdateNested()) {
      phase = 'nested-update';
    }
  }

  if (typeof onRender === 'function') {
    onRender(
      id,
      phase,
      // $FlowFixMe[incompatible-type]: This should be always a number in profiling mode
      finishedWork.actualDuration,
      // $FlowFixMe[incompatible-type]: This should be always a number in profiling mode
      finishedWork.treeBaseDuration,
      // $FlowFixMe[incompatible-type]: This should be always a number in profiling mode
      finishedWork.actualStartTime,
      commitStartTime,
    );
  }

  if (enableProfilerCommitHooks) {
    if (typeof onCommit === 'function') {
      onCommit(id, phase, effectDuration, commitStartTime);
    }
  }
}

/** 在 Profiler 计时启用时安全冲刷 onRender/onCommit，错误归属 finishedWork。 */
export function commitProfilerUpdate(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  effectDuration: number,
) {
  if (enableProfilerTimer) {
    try {
      if (__DEV__) {
        runWithFiberInDEV(
          finishedWork,
          commitProfiler,
          finishedWork,
          current,
          commitStartTime,
          effectDuration,
        );
      } else {
        commitProfiler(finishedWork, current, commitStartTime, effectDuration);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

/** 在 passive effects 完成后调用 onPostCommit，报告 passiveEffectDuration。 */
function commitProfilerPostCommitImpl(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  passiveEffectDuration: number,
): void {
  const {id, onPostCommit} = finishedWork.memoizedProps;

  let phase = current === null ? 'mount' : 'update';
  if (enableProfilerNestedUpdatePhase) {
    if (isCurrentUpdateNested()) {
      phase = 'nested-update';
    }
  }

  if (typeof onPostCommit === 'function') {
    onPostCommit(id, phase, passiveEffectDuration, commitStartTime);
  }
}

/** 用 DEV Fiber 上下文或生产直接调用安全包装 post-commit Profiler callback。 */
export function commitProfilerPostCommit(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  passiveEffectDuration: number,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitProfilerPostCommitImpl,
        finishedWork,
        current,
        commitStartTime,
        passiveEffectDuration,
      );
    } else {
      commitProfilerPostCommitImpl(
        finishedWork,
        current,
        commitStartTime,
        passiveEffectDuration,
      );
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}
