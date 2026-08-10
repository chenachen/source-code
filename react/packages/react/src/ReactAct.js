/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Thenable} from 'shared/ReactTypes';
import type {RendererTask} from './ReactSharedInternalsClient';
import ReactSharedInternals from './ReactSharedInternalsClient';
import queueMacrotask from 'shared/enqueueTask';

import {disableLegacyMode} from 'shared/ReactFeatureFlags';

/** 当前调用栈中的 `act` 作用域深度；嵌套调用共享同一任务队列。 */
let actScopeDepth = 0;

/** 是否已经报告过未等待 `act` 的告警，避免同一测试进程重复刷屏。 */
let didWarnNoAwaitAct = false;

/** 把 `act` 期间收集的多个异常合成为单一可抛值，并兼容缺少 AggregateError 的环境。 */
function aggregateErrors(errors: Array<mixed>): mixed {
  if (errors.length > 1 && typeof AggregateError === 'function') {
    return new AggregateError(errors);
  }
  return errors[0];
}

/**
 * 在受控测试作用域中执行回调，并冲刷 React 调度到内部队列的全部工作。
 *
 * 同步回调仍返回 Thenable，以便挂起或微任务产生后续工作时调用方可以 `await`；最外层作用域
 * 负责最终冲刷和清空共享队列，嵌套作用域只恢复深度。所有退出路径都会恢复旧模式批处理状态
 * 并聚合 renderer 报告的错误。
 *
 * @param callback 触发待测试更新的同步或异步回调。
 * @returns 在回调结果及递归调度工作全部完成后落定的 Thenable。
 */
export function act<T>(callback: () => T | Thenable<T>): Thenable<T> {
  if (__DEV__) {
    // `ReactSharedInternals.actQueue` 非空表示处于 `act`：React 把任务写入此队列，而不是调用
    // 平台调度 API，从而让测试代码能够确定性地冲刷工作。
    //
    // 首次进入时创建空数组，仅离开最外层时清空共享槽位；嵌套 `act` 必须共享队列。
    //
    // 已在作用域中时直接复用现有队列，确保内层调度也由外层统一收尾。
    const prevIsBatchingLegacy = !disableLegacyMode
      ? ReactSharedInternals.isBatchingLegacy
      : false;
    const prevActQueue = ReactSharedInternals.actQueue;
    const prevActScopeDepth = actScopeDepth;
    actScopeDepth++;
    const queue = (ReactSharedInternals.actQueue =
      prevActQueue !== null ? prevActQueue : []);
    // 仅在执行给定回调期间模拟旧模式 `batchedUpdates`；异步事件触发的更新不保留该标记，
    // 这是旧版 `act` 的兼容行为。
    if (!disableLegacyMode) {
      ReactSharedInternals.isBatchingLegacy = true;
    }

    let result;
    // 记录返回 Thenable 是否被消费；异步作用域或发生挂起时，不等待会导致作用域交错，需告警。
    let didAwaitActCall = false;
    try {
      // 在进入 React 工作循环前复位；唯一读取点紧随回调之后，因此回调返回后无需再次复位。
      if (!disableLegacyMode) {
        ReactSharedInternals.didScheduleLegacyUpdate = false;
      }
      result = callback();
      const didScheduleLegacyUpdate = !disableLegacyMode
        ? ReactSharedInternals.didScheduleLegacyUpdate
        : false;

      // 复现旧版 `act`：只要回调同步阶段调度过旧模式更新，就在作用域函数返回后立即冲刷，
      // 即使该函数还返回了 Promise。
      if (!prevIsBatchingLegacy && didScheduleLegacyUpdate) {
        flushActQueue(queue);
      }
      // `isBatchingLegacy` 按同步调用栈恢复，而不是跟随 `act` 的异步作用域；这是 React 18
      // 之前遗留的兼容语义，虽然反直觉但不能在这里改变。
      if (!disableLegacyMode) {
        ReactSharedInternals.isBatchingLegacy = prevIsBatchingLegacy;
      }
    } catch (error) {
      // 异常路径同样按同步调用栈恢复旧模式批处理标记，并把错误交给统一聚合出口。
      ReactSharedInternals.thrownErrors.push(error);
    }
    if (ReactSharedInternals.thrownErrors.length > 0) {
      if (!disableLegacyMode) {
        ReactSharedInternals.isBatchingLegacy = prevIsBatchingLegacy;
      }
      popActScope(prevActQueue, prevActScopeDepth);
      const thrownError = aggregateErrors(ReactSharedInternals.thrownErrors);
      ReactSharedInternals.thrownErrors.length = 0;
      throw thrownError;
    }

    if (
      // $FlowFixMe[invalid-compare]
      result !== null &&
      typeof result === 'object' &&
      // $FlowFixMe[method-unbinding]
      typeof result.then === 'function'
    ) {
      // 回调返回 Promise/Thenable：必须先等待它落定，再冲刷期间累计的 React 任务。
      //
      // `act` 不能直接声明为 async，因为同步分支需要在返回前退出作用域；这里手工实现 Thenable
      // 协议，正是它与下方同步分支的主要差异。
      const thenable = result as any as Thenable<T>;

      // 异步作用域若未被等待会让多个 `act` 相互穿插；延迟几个微任务检测，当前先告警，未来
      // 可以升级为错误。
      queueSeveralMicrotasks(() => {
        if (!didAwaitActCall && !didWarnNoAwaitAct) {
          didWarnNoAwaitAct = true;
          console.error(
            'You called act(async () => ...) without await. ' +
              'This could lead to unexpected testing behaviour, ' +
              'interleaving multiple act calls and mixing their ' +
              'scopes. ' +
              'You should - await act(async () => ...);',
          );
        }
      });

      return {
        /** 消费异步 `act`，等待用户 Thenable 后退出作用域并递归冲刷最外层队列。 */
        then(resolve: T => mixed, reject: mixed => mixed) {
          didAwaitActCall = true;
          thenable.then(
            returnValue => {
              popActScope(prevActQueue, prevActScopeDepth);
              if (prevActScopeDepth === 0) {
                // 正在退出最外层 `act`：先同步冲刷，再跨宏任务追踪微任务新调度的工作。
                try {
                  flushActQueue(queue);
                  queueMacrotask(() =>
                    // 递归冲刷微任务新调度的任务，直到队列稳定为空。
                    recursivelyFlushAsyncActWork(returnValue, resolve, reject),
                  );
                } catch (error) {
                  // 用户返回的 Thenable 不一定是真 Promise，且 `flushActQueue` 可能抛错，
                  // 因而必须捕获并走统一错误聚合路径。
                  ReactSharedInternals.thrownErrors.push(error);
                }
                if (ReactSharedInternals.thrownErrors.length > 0) {
                  const thrownError = aggregateErrors(
                    ReactSharedInternals.thrownErrors,
                  );
                  ReactSharedInternals.thrownErrors.length = 0;
                  reject(thrownError);
                }
              } else {
                resolve(returnValue);
              }
            },
            error => {
              popActScope(prevActQueue, prevActScopeDepth);
              if (ReactSharedInternals.thrownErrors.length > 0) {
                const thrownError = aggregateErrors(
                  ReactSharedInternals.thrownErrors,
                );
                ReactSharedInternals.thrownErrors.length = 0;
                reject(thrownError);
              } else {
                reject(error);
              }
            },
          );
        },
      };
    } else {
      const returnValue: T = result as any;
      // 同步回调无需等待，立即退出当前作用域。
      popActScope(prevActQueue, prevActScopeDepth);
      if (prevActScopeDepth === 0) {
        // 退出最外层 `act` 时立即冲刷队列。
        flushActQueue(queue);

        // 冲刷后队列仍非空，说明组件挂起并主动让出主线程；后续必须在异步任务中继续。
        //
        // 此时若调用方不等待 `act`，测试断言可能早于恢复工作；当前告警，未来可升级为错误。
        if (queue.length !== 0) {
          queueSeveralMicrotasks(() => {
            if (!didAwaitActCall && !didWarnNoAwaitAct) {
              didWarnNoAwaitAct = true;
              console.error(
                'A component suspended inside an `act` scope, but the ' +
                  '`act` call was not awaited. When testing React ' +
                  'components that depend on asynchronous data, you must ' +
                  'await the result:\n\n' +
                  'await act(() => ...)',
              );
            }
          });
        }

        // 这里需要兼容同步 `act` 历史上允许不等待的行为。
        //
        // 当前并不强制所有 `act` 都被等待；同步回调必须在返回前先退出共享作用域。
        //
        // 若调用方随后消费返回的 Thenable，下方会立即恢复队列并继续冲刷，对外不可观察到空档。
        //
        // 异步回调不受此兼容分支影响，因为它始终要求等待。
        //
        // TODO：未来可考虑无论回调同步或异步，都强制等待所有 `act` 调用。
        ReactSharedInternals.actQueue = null;
      }

      if (ReactSharedInternals.thrownErrors.length > 0) {
        const thrownError = aggregateErrors(ReactSharedInternals.thrownErrors);
        ReactSharedInternals.thrownErrors.length = 0;
        throw thrownError;
      }

      return {
        /** 消费同步 `act` 的可等待结果；最外层会恢复队列并追踪挂起后的异步工作。 */
        then(resolve: T => mixed, reject: mixed => mixed) {
          didAwaitActCall = true;
          if (prevActScopeDepth === 0) {
            // 若同步 `act` 被等待，恢复刚才暂时卸载的队列，以便继续冲刷挂起后的工作。
            ReactSharedInternals.actQueue = queue;
            queueMacrotask(() =>
              // 递归冲刷微任务新调度的任务，直到队列稳定为空。
              recursivelyFlushAsyncActWork(returnValue, resolve, reject),
            );
          } else {
            resolve(returnValue);
          }
        },
      };
    }
  } else {
    throw new Error('act(...) is not supported in production builds of React.');
  }
}

/**
 * 恢复进入当前 `act` 前的深度，并在开发环境检测未按顺序等待导致的重叠作用域。
 */
function popActScope(
  prevActQueue: null | Array<RendererTask>,
  prevActScopeDepth: number,
) {
  if (__DEV__) {
    if (prevActScopeDepth !== actScopeDepth - 1) {
      console.error(
        'You seem to have overlapping act() calls, this is not supported. ' +
          'Be sure to await previous act() calls before making a new one. ',
      );
    }
    actScopeDepth = prevActScopeDepth;
  }
}

/**
 * 跨宏任务反复冲刷异步 `act` 工作，直到队列为空，再解析结果或拒绝聚合错误。
 * 宏任务边界允许 Promise 微任务先把 continuation 重新加入队列。
 */
function recursivelyFlushAsyncActWork<T>(
  returnValue: T,
  resolve: T => mixed,
  reject: mixed => mixed,
) {
  if (__DEV__) {
    // 检查上一轮冲刷之后是否又异步调度了任务。
    const queue = ReactSharedInternals.actQueue;
    if (queue !== null) {
      if (queue.length !== 0) {
        // 新任务通常来自微任务；持续冲刷，直到不再产生后续工作。
        try {
          flushActQueue(queue);
          // 本轮工作可能继续调度异步任务；等待一个宏任务，让相关微任务先入队后再检查。
          queueMacrotask(() =>
            recursivelyFlushAsyncActWork(returnValue, resolve, reject),
          );
          return;
        } catch (error) {
          // 抛错时保留尚未执行的任务，并交给统一错误出口拒绝调用方。
          ReactSharedInternals.thrownErrors.push(error);
        }
      } else {
        // 队列稳定为空，卸载共享槽位后即可完成最外层 `act`。
        ReactSharedInternals.actQueue = null;
      }
    }
    if (ReactSharedInternals.thrownErrors.length > 0) {
      const thrownError = aggregateErrors(ReactSharedInternals.thrownErrors);
      ReactSharedInternals.thrownErrors.length = 0;
      reject(thrownError);
    } else {
      resolve(returnValue);
    }
  }
}

/** 防止 renderer continuation 在冲刷期间重入同一队列。 */
let isFlushing = false;
/**
 * 同步执行 `act` 队列中的 renderer 任务及其 continuation。
 *
 * 若任务调用过 `use` 并返回 continuation，先让出给微任务解包可能已兑现的 Promise；异常时
 * 删除已消费前缀、保留剩余任务，并把错误放入共享聚合队列。
 */
function flushActQueue(queue: Array<RendererTask>) {
  if (__DEV__) {
    if (!isFlushing) {
      // 防止 continuation 或 renderer 回调重入同一冲刷循环。
      isFlushing = true;
      let i = 0;
      try {
        for (; i < queue.length; i++) {
          let callback: RendererTask = queue[i];
          do {
            ReactSharedInternals.didUsePromise = false;
            const continuation = callback(false);
            if (continuation !== null) {
              if (ReactSharedInternals.didUsePromise) {
                // 组件刚刚挂起；让出主线程，使可能已兑现的 Promise 在微任务中 ping。这样下轮
                // 可从当前回调继续，而不必在本轮展开全部栈。
                queue[i] = callback;
                queue.splice(0, i);
                return;
              }
              callback = continuation;
            } else {
              break;
            }
          } while (true);
        }
        // 所有任务及 continuation 均已完成，原地清空数组供嵌套作用域继续复用。
        queue.length = 0;
      } catch (error) {
        // 抛错时只移除已消费项，保留后续回调供错误处理或诊断观察。
        queue.splice(0, i + 1);
        ReactSharedInternals.thrownErrors.push(error);
      } finally {
        isFlushing = false;
      }
    }
  }
}

/**
 * 延迟检测 `act` 是否被等待的调度器。
 *
 * 等两个微任务可兼容“从 async 函数直接返回 `act` 而未先 await”的常见写法；嵌套过深仍可能
 * 告警，显式 await 即可消除。缺少 `queueMicrotask` 时退回宏任务，代价是某些测试环境中的
 * 告警可能更晚出现。
 */
const queueSeveralMicrotasks =
  typeof queueMicrotask === 'function'
    ? (callback: () => void) => {
        queueMicrotask(() => queueMicrotask(callback));
      }
    : queueMacrotask;
