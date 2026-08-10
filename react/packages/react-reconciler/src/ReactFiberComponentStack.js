/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableViewTransition} from 'shared/ReactFeatureFlags';
import type {Fiber} from './ReactInternalTypes';
import type {ReactComponentInfo} from 'shared/ReactTypes';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  LazyComponent,
  SuspenseComponent,
  SuspenseListComponent,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
  ClassComponent,
  HostText,
  ViewTransitionComponent,
  ActivityComponent,
} from './ReactWorkTags';
import {
  describeBuiltInComponentFrame,
  describeFunctionComponentFrame,
  describeClassComponentFrame,
  describeDebugInfoFrame,
} from 'shared/ReactComponentStackFrame';
import {formatOwnerStack} from 'shared/ReactOwnerStackFrames';

/**
 * 把单个 Fiber 转成一行组件栈 frame。
 *
 * `childFiber` 用于区分沿 Suspense primary 还是 fallback 分支上行；无法向用户解释的内部标签返回空串。
 */
function describeFiber(fiber: Fiber, childFiber: null | Fiber): string {
  switch (fiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      return describeBuiltInComponentFrame(fiber.type);
    case LazyComponent:
      // TODO：支持 Thenable 直接作为组件类型后，应给该占位名称重新命名。
      return describeBuiltInComponentFrame('Lazy');
    case SuspenseComponent:
      if (fiber.child !== childFiber && childFiber !== null) {
        // 从第二个 child 上行表示当前位于 Suspense fallback 子树。
        return describeBuiltInComponentFrame('Suspense Fallback');
      }
      return describeBuiltInComponentFrame('Suspense');
    case SuspenseListComponent:
      return describeBuiltInComponentFrame('SuspenseList');
    case FunctionComponent:
    case SimpleMemoComponent:
      return describeFunctionComponentFrame(fiber.type);
    case ForwardRef:
      return describeFunctionComponentFrame(fiber.type.render);
    case ClassComponent:
      return describeClassComponentFrame(fiber.type);
    case ActivityComponent:
      return describeBuiltInComponentFrame('Activity');
    case ViewTransitionComponent:
      if (enableViewTransition) {
        return describeBuiltInComponentFrame('ViewTransition');
      }
    // 未启用 ViewTransition 时继续落入默认空 frame。
    default:
      return '';
  }
}

/**
 * 沿 Fiber return 链生成开发/生产都可使用的组件栈。
 *
 * 开发构建还把 Server Component debugInfo 逆序插入对应客户端 Fiber frame；诊断生成自身失败时
 * 返回带原异常的文本，不能覆盖正在处理的用户错误。
 */
export function getStackByFiberInDevAndProd(workInProgress: Fiber): string {
  try {
    let info = '';
    let node: Fiber = workInProgress;
    let previous: null | Fiber = null;
    do {
      info += describeFiber(node, previous);
      if (__DEV__) {
        // Server Component debug frames 按记录逆序追加，恢复从内到外的组件栈顺序。
        const debugInfo = node._debugInfo;
        if (debugInfo) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            const entry = debugInfo[i];
            if (typeof entry.name === 'string') {
              info += describeDebugInfoFrame(
                entry.name,
                entry.env,
                entry.debugLocation,
              );
            }
          }
        }
      }
      previous = node;
      // $FlowFixMe[incompatible-type] we bail out when we get a null
      node = node.return;
    } while (node);
    return info;
  } catch (x) {
    return '\nError generating stack: ' + x.message + '\n' + x.stack;
  }
}

/** 仅用函数 displayName/name 生成 frame，不探测或展示定义行号。 */
function describeFunctionComponentFrameWithoutLineNumber(fn: Function): string {
  // owner stack 的当前内建节点只需名称；定义行会误导为当前 JSX 创建现场。
  const name = fn ? fn.displayName || fn.name : '';
  return name ? describeBuiltInComponentFrame(name) : '';
}

/**
 * 沿开发期 `_debugOwner` 链生成“谁创建了谁”的 owner stack。
 *
 * 它不同于 return 树路径：HostText 借父节点归因，客户端 Fiber 使用创建时 debugStack，
 * Server Component info 使用其 owner/debugStack 链；生产构建固定返回空串。
 */
export function getOwnerStackByFiberInDev(workInProgress: Fiber): string {
  if (!__DEV__) {
    return '';
  }
  try {
    let info = '';

    if (workInProgress.tag === HostText) {
      // 文本节点不经 JSX 独立创建，因此没有 owner/debugStack；借宿主父 Fiber 归因。
      workInProgress = workInProgress.return as any;
    }

    // 当前 Fiber 的 owner frame 指向其 JSX 创建位置，不包含“当前正在执行组件”的名字；该名字通常
    // 已在 JavaScript 调用栈中。内建节点没有可保留的用户函数 frame，所以额外补一个当前内建名称。
    // 完全没有 owner 时也补根组件名，避免得到无法定位的空栈。
    switch (workInProgress.tag) {
      case HostHoistable:
      case HostSingleton:
      case HostComponent:
        info += describeBuiltInComponentFrame(workInProgress.type);
        break;
      case SuspenseComponent:
        info += describeBuiltInComponentFrame('Suspense');
        break;
      case SuspenseListComponent:
        info += describeBuiltInComponentFrame('SuspenseList');
        break;
      case ActivityComponent:
        info += describeBuiltInComponentFrame('Activity');
        break;
      case ViewTransitionComponent:
        if (enableViewTransition) {
          info += describeBuiltInComponentFrame('ViewTransition');
          break;
        }
      // 未启用 ViewTransition 时按用户提供 type 的组件分支继续处理。
      case FunctionComponent:
      case SimpleMemoComponent:
      case ClassComponent:
        if (!workInProgress._debugOwner && info === '') {
          // 只有完全没有创建现场时，才用组件名作为唯一兜底 frame。
          info += describeFunctionComponentFrameWithoutLineNumber(
            workInProgress.type,
          );
        }
        break;
      case ForwardRef:
        if (!workInProgress._debugOwner && info === '') {
          info += describeFunctionComponentFrameWithoutLineNumber(
            workInProgress.type.render,
          );
        }
        break;
    }

    let owner: void | null | Fiber | ReactComponentInfo = workInProgress;

    while (owner) {
      if (typeof owner.tag === 'number') {
        const fiber: Fiber = owner as any;
        owner = fiber._debugOwner;
        const debugStack = fiber._debugStack;
        // 没有 owner 的 JSX 通常来自框架启动或模块级提升，调用栈噪声大且不扎根于 React render，
        // 因此不打印其 debugStack；只有确有 owner 时才把创建现场加入链。
        if (owner && debugStack) {
          const formattedStack = formatOwnerStack(debugStack);
          if (formattedStack !== '') {
            info += '\n' + formattedStack;
          }
        }
      } else if (owner.debugStack != null) {
        // Server Component 记录没有 Fiber tag，沿自身 owner/debugStack 链继续。
        const ownerStack: Error = owner.debugStack;
        owner = owner.owner;
        if (owner && ownerStack) {
          // TODO：评估缓存格式化后的 Server Component owner frame。
          info += '\n' + formatOwnerStack(ownerStack);
        }
      } else {
        break;
      }
    }
    return info;
  } catch (x) {
    return '\nError generating stack: ' + x.message + '\n' + x.stack;
  }
}
