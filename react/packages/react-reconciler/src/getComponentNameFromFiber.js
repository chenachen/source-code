/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext, ReactConsumerType} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';

import {
  disableLegacyMode,
  enableLegacyHidden,
  enableViewTransition,
} from 'shared/ReactFeatureFlags';

import {
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostPortal,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  Fragment,
  Mode,
  ContextConsumer,
  ContextProvider,
  ForwardRef,
  Profiler,
  SuspenseComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  IncompleteFunctionComponent,
  DehydratedFragment,
  SuspenseListComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
  Throw,
  ViewTransitionComponent,
  ActivityComponent,
} from 'react-reconciler/src/ReactWorkTags';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// 与 shared/getComponentNameFromType 的包装命名规则保持同步。
/** 返回包装器 displayName，或用 `Wrapper(Inner)` 组合可读组件名。 */
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = innerType.displayName || innerType.name || '';
  return (
    (outerType as any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// 与 shared/getComponentNameFromType 的 Context 命名规则保持同步。
/** 返回 Context 自定义 displayName；未设置时使用稳定兜底名。 */
function getContextName(type: ReactContext<any>) {
  return type.displayName || 'Context';
}

/** 从客户端 Fiber 或 Server Component 调试记录提取 owner 显示名。 */
export function getComponentNameFromOwner(
  owner: Fiber | ReactComponentInfo,
): string | null {
  if (typeof owner.tag === 'number') {
    return getComponentNameFromFiber(owner as any);
  }
  if (typeof owner.name === 'string') {
    return owner.name;
  }
  return null;
}

/**
 * 按 WorkTag 与运行时 type 推导 Fiber 的诊断显示名。
 *
 * 内建边界返回稳定名称，用户组件优先 displayName/name；Offscreen 借父 Fiber 表示其用户可见归属，
 * 未启用的实验标签与无法识别的内部节点返回 null。
 */
export default function getComponentNameFromFiber(fiber: Fiber): string | null {
  const {tag, type} = fiber;
  switch (tag) {
    case ActivityComponent:
      return 'Activity';
    case CacheComponent:
      return 'Cache';
    case ContextConsumer:
      const consumer: ReactConsumerType<any> = type as any;
      return getContextName(consumer._context) + '.Consumer';
    case ContextProvider:
      const context: ReactContext<any> = type as any;
      return getContextName(context);
    case DehydratedFragment:
      return 'DehydratedFragment';
    case ForwardRef:
      return getWrappedName(type, type.render, 'ForwardRef');
    case Fragment:
      return 'Fragment';
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      // 宿主 type 本身就是显示名，例如 DOM 的 "div" 或 Native 的 "View"。
      return type;
    case HostPortal:
      return 'Portal';
    case HostRoot:
      return 'Root';
    case HostText:
      return 'Text';
    case LazyComponent:
      // lazy 的名字来自已解析 type；WorkTag 本身没有更具体信息。
      return getComponentNameFromType(type);
    case Mode:
      if (type === REACT_STRICT_MODE_TYPE) {
        // 不得比 shared/getComponentNameFromType 返回得更模糊。
        return 'StrictMode';
      }
      return 'Mode';
    case OffscreenComponent:
      if (fiber.return !== null) {
        return getComponentNameFromFiber(fiber.return);
      }
      return null;
    case Profiler:
      return 'Profiler';
    case ScopeComponent:
      return 'Scope';
    case SuspenseComponent:
      return 'Suspense';
    case SuspenseListComponent:
      return 'SuspenseList';
    case TracingMarkerComponent:
      return 'TracingMarker';
    case ViewTransitionComponent:
      if (enableViewTransition) {
        return 'ViewTransition';
      }
    // 下列标签都从用户提供的 type 取显示名，继续共用分支。
    case IncompleteClassComponent:
    case IncompleteFunctionComponent:
      if (disableLegacyMode) {
        break;
      }
    // legacy mode 开启时，incomplete class/function 继续按用户组件命名。
    case ClassComponent:
    case FunctionComponent:
    case MemoComponent:
    case SimpleMemoComponent:
      if (typeof type === 'function') {
        return (type as any).displayName || type.name || null;
      }
      if (typeof type === 'string') {
        return type;
      }
      break;
    case LegacyHiddenComponent:
      if (enableLegacyHidden) {
        return 'LegacyHidden';
      }
      break;
    case Throw: {
      if (__DEV__) {
        // child 位置的 Throw 没有自身用户类型，使用最内层 Server Component debugInfo 或父 Fiber 名称。
        const debugInfo = fiber._debugInfo;
        if (debugInfo != null) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            if (typeof debugInfo[i].name === 'string') {
              return debugInfo[i].name;
            }
          }
        }
        if (fiber.return === null) {
          return null;
        }
        return getComponentNameFromFiber(fiber.return);
      }
      return null;
    }
  }

  return null;
}
