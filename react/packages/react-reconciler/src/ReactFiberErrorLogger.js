/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {CapturedValue} from './ReactCapturedValue';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';

import {ClassComponent} from './ReactWorkTags';

import reportGlobalError from 'shared/reportGlobalError';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {bindToConsole} from './ReactFiberConfig';

// 通过内部旁路传递组件名称，避免把这项仅供默认处理器使用的信息暴露为公共 API。
let componentName: null | string = null;
let errorBoundaryName: null | string = null;

/**
 * 默认的根级未捕获错误处理器。
 *
 * 先把原始错误交给宿主的全局错误机制，再在开发环境补充发生错误的组件和添加
 * Error Boundary 的建议。组件栈由控制台包装层附加，因此这里不重复拼接。
 *
 * @param error 根渲染过程中未被 Error Boundary 捕获的值。
 * @param errorInfo 与错误关联的 React 组件栈。
 */
export function defaultOnUncaughtError(
  error: mixed,
  errorInfo: {
    /** React 组件栈；默认实现由控制台集成负责显示。 */
    +componentStack?: ?string
  },
): void {
  // 调用方可以覆盖此处理器以屏蔽警告，例如测试环境会这样做。
  // 背景见 https://github.com/facebook/react/pull/13384

  // 根级未捕获错误要上报给浏览器的 onerror；该通道没有组件栈与 React 附言，
  // 因而另用 console.warn 补充这些上下文。
  reportGlobalError(error);
  if (__DEV__) {
    const componentNameMessage = componentName
      ? `An error occurred in the <${componentName}> component.`
      : 'An error occurred in one of your React components.';

    const errorBoundaryMessage =
      'Consider adding an error boundary to your tree to customize error handling behavior.\n' +
      'Visit https://react.dev/link/error-boundaries to learn more about error boundaries.';

    try {
      console.warn(
        '%s\n\n%s\n',
        componentNameMessage,
        errorBoundaryMessage,
        // 组件栈由 console.error 包装层追加到末尾。
      );
    } finally {
      // 此空 finally 不吞掉报告异常；外层 logUncaughtError 会捕获并在定时任务中重抛。
    }
  }
}

/**
 * 默认的 Error Boundary 已捕获错误处理器。
 *
 * 开发环境输出原始错误、故障组件和负责恢复的边界；生产环境直接调用原生
 * `console.error`，保留浏览器对 Error 对象、JS 栈及原生格式的展示。
 *
 * @param error 已被边界捕获的错误值。
 * @param errorInfo 组件栈以及实际接住错误的边界实例。
 */
export function defaultOnCaughtError(
  error: mixed,
  errorInfo: {
    /** 故障点对应的 React 组件栈。 */
    +componentStack?: ?string,
    /** 捕获错误的类组件实例；无法取得时为空。 */
    +errorBoundary?: ?component(...props: any),
  },
): void {
  // 调用方可以覆盖此处理器以屏蔽警告，例如测试环境会这样做。
  // 背景见 https://github.com/facebook/react/pull/13384

  // 错误已经由 Error Boundary 捕获。
  if (__DEV__) {
    const componentNameMessage = componentName
      ? `The above error occurred in the <${componentName}> component.`
      : 'The above error occurred in one of your React components.';

    // 开发环境在原始错误之外补充组件栈和边界恢复说明。
    const recreateMessage =
      `React will try to recreate this component tree from scratch ` +
      `using the error boundary you provided, ${
        errorBoundaryName || 'Anonymous'
      }.`;

    try {
      if (
        typeof error === 'object' &&
        error !== null &&
        typeof error.environmentName === 'string'
      ) {
        // 这是服务端错误：像重放服务端 console 日志一样显示环境徽标，明确抛错源在服务端。
        bindToConsole(
          'error',
          [
            '%o\n\n%s\n\n%s\n',
            error,
            componentNameMessage,
            recreateMessage,
            // 组件栈由 DevTools 或 console.createTask 追加到末尾。
          ],
          error.environmentName,
        )();
      } else {
        console.error(
          '%o\n\n%s\n\n%s\n',
          error,
          componentNameMessage,
          recreateMessage,
          // 组件栈由 DevTools 或 console.createTask 追加到末尾。
        );
      }
    } finally {
      // 报告异常仍向外传播；logCaughtError 负责把它转移到当前提交栈之外。
    }
  } else {
    // 生产环境直接传递 Error 对象，让浏览器原生显示消息、JS 栈和宿主附加信息。
    // 不经过 React 的 console 包装层，但 React DevTools 仍可附加组件栈。
    console['error'](error);
  }
}

/**
 * 默认的可恢复错误处理器，把错误交给宿主全局报告通道。
 *
 * @param error React 已经恢复、但仍需要向应用报告的错误。
 * @param errorInfo 与错误关联的组件栈。
 */
export function defaultOnRecoverableError(
  error: mixed,
  errorInfo: {
    /** React 组件栈；供自定义处理器诊断。 */
    +componentStack?: ?string
  },
) {
  reportGlobalError(error);
}

/**
 * 在提交根级未捕获错误时调用根上的 `onUncaughtError` 回调。
 *
 * 开发环境先设置默认处理器读取的组件名称旁路；`act` 内的错误改存入测试队列，
 * 由 `act` 重新抛出。用户回调自身抛错时延迟到当前 React 栈之外再次抛出，保证
 * reconciler 内部状态能够完成收尾。
 */
export function logUncaughtError(
  root: FiberRoot,
  errorInfo: CapturedValue<mixed>,
): void {
  try {
    if (__DEV__) {
      componentName = errorInfo.source
        ? getComponentNameFromFiber(errorInfo.source)
        : null;
      errorBoundaryName = null;
    }
    const error = errorInfo.value as any;
    if (__DEV__ && ReactSharedInternals.actQueue !== null) {
      // act 内的未捕获错误由 act 统一记录，并重新抛回测试调用栈。
      ReactSharedInternals.thrownErrors.push(error);
      return;
    }
    const onUncaughtError = root.onUncaughtError;
    onUncaughtError(error, {
      componentStack: errorInfo.stack,
    });
  } catch (e) {
    // 此函数不能在 React 调用栈内抛错，否则内部状态会失配。若 console.error 被
    // 覆盖，或错误报告 UI 自身抛错，则把异常延迟到常规 React 栈外作为最后保障。
    // https://github.com/facebook/react/issues/13188
    setTimeout(() => {
      throw e;
    });
  }
}

/**
 * 在 Error Boundary 捕获错误后调用根上的 `onCaughtError` 回调。
 *
 * 回调得到组件栈和捕获边界实例；若用户回调本身抛错，则与未捕获错误通道一样，
 * 延迟到 React 栈外重新抛出，避免打断提交阶段的内部状态恢复。
 */
export function logCaughtError(
  root: FiberRoot,
  boundary: Fiber,
  errorInfo: CapturedValue<mixed>,
): void {
  try {
    if (__DEV__) {
      componentName = errorInfo.source
        ? getComponentNameFromFiber(errorInfo.source)
        : null;
      errorBoundaryName = getComponentNameFromFiber(boundary);
    }
    const error = errorInfo.value as any;
    const onCaughtError = root.onCaughtError;
    onCaughtError(error, {
      componentStack: errorInfo.stack,
      errorBoundary:
        boundary.tag === ClassComponent
          ? boundary.stateNode // 当前只有类组件能充当 Error Boundary，因此通常走此分支。
          : null,
    });
  } catch (e) {
    // 此函数不能在 React 调用栈内抛错，否则内部状态会失配。若 console.error 被
    // 覆盖，或错误报告 UI 自身抛错，则把异常延迟到常规 React 栈外作为最后保障。
    // https://github.com/facebook/react/issues/13188
    setTimeout(() => {
      throw e;
    });
  }
}
