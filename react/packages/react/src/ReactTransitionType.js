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
 * 把类型标签加入当前 transition；若位于异步间隙，则建立隐式 transition 重新执行。
 *
 * @param type 调用方定义的 transition 分类标签。
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
      // 当前位于 await 后的异步间隙，没有同步可见的 `T`；用隐式 `startTransition` 恢复关联，
      // 同时在开发环境检查这里是否确实由外层异步 transition 到达。
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
