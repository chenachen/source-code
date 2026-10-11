/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {LazyComponent} from 'react/src/ReactLazy';
import type {ReactContext, ReactConsumerType} from 'shared/ReactTypes';

import {
  REACT_CONTEXT_TYPE,
  REACT_CONSUMER_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_MEMO_TYPE,
  REACT_PROFILER_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_LAZY_TYPE,
  REACT_TRACING_MARKER_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
  REACT_ACTIVITY_TYPE,
} from 'shared/ReactSymbols';

import {
  enableTransitionTracing,
  enableViewTransition,
} from './ReactFeatureFlags';

// 与 `react-reconciler/getComponentNameFromFiber` 保持同步。
/**
 * 为 forwardRef 诊断组合包装名与内部函数显示名。
 * @param outerType - 包装描述对象；其 displayName 为真时优先返回。
 * @param innerType - 内部 render 函数，依次选择 displayName、name。
 * @param wrapperName - 包装标签，如 ForwardRef；内部无名时直接返回该标签。
 */
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const displayName = (outerType as any).displayName;
  if (displayName) {
    return displayName;
  }
  const functionName = innerType.displayName || innerType.name || '';
  return functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName;
}

// 与 `react-reconciler/getComponentNameFromFiber` 保持同步。
/** 返回 Context 的显式 displayName，未设置时回退为 `Context`。 */
function getContextName(type: ReactContext<any>) {
  return type.displayName || 'Context';
}

/** 标识 RSC 客户端引用；其调试命名协议尚未定义。 */
const REACT_CLIENT_REFERENCE = Symbol.for('react.client.reference');

/**
 * 从公开组件类型或 React 特殊类型描述对象推导诊断名称。
 *
 * @remarks reconciler 已拥有 Fiber 时应优先使用 `getComponentNameFromFiber()`，因为它
 * 能处理更多 tag 上下文；lazy 初始化失败和未知客户端引用在此返回 `null`。
 * @param type - 元素公开类型、宿主字符串或 React 特殊标记，不是 Fiber 实例。
 * @returns 可用的显示名称；无名称、未知标记或 lazy 抛错时返回 null。
 * @remarks lazy._init 可能启动加载或改变 payload，并非纯粹读取名称；该分支捕获
 * thenable/错误，其他 getter 及包装字段读取异常仍向调用方传播。类型名没有缓存，
 * 后续修改 displayName 可改变结果。DEV 中传入带数值 tag 的对象会先报告内部误用。
 */
export default function getComponentNameFromType(type: mixed): string | null {
  if (type == null) {
    // HostRoot、文本节点和无效类型都没有组件名称。
    return null;
  }
  if (typeof type === 'function') {
    if ((type as any).$$typeof === REACT_CLIENT_REFERENCE) {
      // TODO：为带 debug info 的客户端引用定义统一命名约定。
      return null;
    }
    return (type as any).displayName || type.name || null;
  }
  if (typeof type === 'string') {
    return type;
  }
  switch (type) {
    case REACT_FRAGMENT_TYPE:
      return 'Fragment';
    case REACT_PROFILER_TYPE:
      return 'Profiler';
    case REACT_STRICT_MODE_TYPE:
      return 'StrictMode';
    case REACT_SUSPENSE_TYPE:
      return 'Suspense';
    case REACT_SUSPENSE_LIST_TYPE:
      return 'SuspenseList';
    case REACT_ACTIVITY_TYPE:
      return 'Activity';
    case REACT_VIEW_TRANSITION_TYPE:
      if (enableViewTransition) {
        return 'ViewTransition';
      }
    // 此处没有 break：ViewTransition 关闭时会落入 TracingMarker 分支；若追踪开关
    // 同时开启，按当前控制流返回 TracingMarker，否则最终返回 null。
    case REACT_TRACING_MARKER_TYPE:
      if (enableTransitionTracing) {
        return 'TracingMarker';
      }
  }
  if (typeof type === 'object') {
    if (__DEV__) {
      if (typeof (type as any).tag === 'number') {
        console.error(
          'Received an unexpected object in getComponentNameFromType(). ' +
            'This is likely a bug in React. Please file an issue.',
        );
      }
    }
    switch (type.$$typeof) {
      case REACT_PORTAL_TYPE:
        return 'Portal';
      case REACT_CONTEXT_TYPE:
        const context: ReactContext<any> = type as any;
        return getContextName(context);
      case REACT_CONSUMER_TYPE:
        const consumer: ReactConsumerType<any> = type as any;
        return getContextName(consumer._context) + '.Consumer';
      case REACT_FORWARD_REF_TYPE:
        return getWrappedName(type, type.render, 'ForwardRef');
      case REACT_MEMO_TYPE:
        const outerName = (type as any).displayName || null;
        if (outerName !== null) {
          return outerName;
        }
        return getComponentNameFromType(type.type) || 'Memo';
      case REACT_LAZY_TYPE: {
        const lazyComponent: LazyComponent<any, any> = type as any;
        const payload = lazyComponent._payload;
        const init = lazyComponent._init;
        try {
          return getComponentNameFromType(init(payload));
        } catch (x) {
          return null;
        }
      }
    }
  }
  return null;
}
