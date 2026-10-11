/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  enableViewTransition,
  enableGestureTransition,
} from 'shared/ReactFeatureFlags';
import {startTransition} from './ReactStartTransition';

/** 当前 transition 关联的去重类型标签集合。 */
export type TransitionTypes = Array<string>;

/**
 * 把类型标签加入当前 transition 并去重；没有当前 transition 时，建立隐式 transition 再登记。
 * DEV 在没有任何尚未落定的异步 transition 时告警；关闭 ViewTransition 特性时为空操作。
 *
 * @param type 调用方定义的 transition 分类标签。
 * @remarks 有当前 T 时直接修改其数组，indexOf 去重保持首次添加顺序，不校验/转义标签。
 * 无 T 时调用 startTransition 同步重入本函数，把类型交给新的 scope；告警不会阻止
 * 此登记。该入口只添加元数据，不自行创建 DOM 动画、安排状态更新或等待完成。
 */
export function addTransitionType(type: string): void {
  if (enableViewTransition) {
    const transition = ReactSharedInternals.T;
    if (transition !== null) {
      const transitionTypes = transition.types;
      if (transitionTypes === null) {
        transition.types = [type];
      } else if (transitionTypes.indexOf(type) === -1) {
        transitionTypes.push(type);
      }
    } else {
      // `T` 为空可能来自 await 后，也可能来自独立调用。隐式 startTransition 创建新的上下文；
      // asyncTransitions 只能表明有异步 transition 在途，不能证明当前调用属于哪一个。
      if (__DEV__) {
        if (ReactSharedInternals.asyncTransitions === 0) {
          if (enableGestureTransition) {
            console.error(
              'addTransitionType can only be called inside a `startTransition()` ' +
                'or `startGestureTransition()` callback. ' +
                'It must be associated with a specific Transition.',
            );
          } else {
            console.error(
              'addTransitionType can only be called inside a `startTransition()` ' +
                'callback. It must be associated with a specific Transition.',
            );
          }
        }
      }
      startTransition(addTransitionType.bind(null, type));
    }
  }
}
