/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack';

import {disableLegacyContext} from 'shared/ReactFeatureFlags';
import {ClassComponent, HostRoot} from './ReactWorkTags';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';

import {createCursor, push, pop} from './ReactFiberStack';

let warnedAboutMissingGetChildContext;

if (__DEV__) {
  warnedAboutMissingGetChildContext = {} as {
    /** 组件名到“已报告缺少 getChildContext”标记的映射。 */
    [string]: boolean
  };
}

/** 未提供或已禁用遗留 Context 时共享的只读空对象。 */
export const emptyContextObject: {} = {};
if (__DEV__) {
  Object.freeze(emptyContextObject);
}

// 栈上当前合并后 Context 对象的游标。
const contextStackCursor: StackCursor<Object> =
  createCursor(emptyContextObject);
// 表示 Context 是否变化的布尔栈游标。
const didPerformWorkStackCursor: StackCursor<boolean> = createCursor(false);
// 保存入栈前的父 Context；即使已经压入下一个 provider，仍能取父值做合并。
let previousContext: Object = emptyContextObject;

/**
 * 读取类组件可见的完整遗留 Context，不按 `contextTypes` 掩码。
 * provider 读取自身时若 child Context 已提前入栈，必须返回 previousContext，避免
 * provider “看见”自己刚提供给后代的值。
 */
function getUnmaskedContext(
  workInProgress: Fiber,
  Component: Function,
  didPushOwnContextIfProvider: boolean,
): Object {
  if (disableLegacyContext) {
    return emptyContextObject;
  } else {
    if (didPushOwnContextIfProvider && isContextProvider(Component)) {
      // provider 自身不应看见自己的 child Context，读取入栈前的父 Context。
      return previousContext;
    }
    return contextStackCursor.current;
  }
}

/** 在类实例上缓存完整 Context 与按 `contextTypes` 裁剪后的 Context。 */
function cacheContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
  maskedContext: Object,
): void {
  if (disableLegacyContext) {
    return;
  } else {
    const instance = workInProgress.stateNode;
    instance.__reactInternalMemoizedUnmaskedChildContext = unmaskedContext;
    instance.__reactInternalMemoizedMaskedChildContext = maskedContext;
  }
}

/**
 * 根据组件声明的 `contextTypes` 从完整遗留 Context 构造可见子集。
 * 完整 Context 引用未变时复用实例缓存，避免无意义触发 componentWillReceiveProps，
 * 以及该生命周期 setState 造成的潜在无限循环。
 */
function getMaskedContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
): Object {
  if (disableLegacyContext) {
    return emptyContextObject;
  } else {
    const type = workInProgress.type;
    const contextTypes = type.contextTypes;
    if (!contextTypes) {
      return emptyContextObject;
    }

    // 完整 Context 未变时不要重建掩码值，否则会多调用 componentWillReceiveProps；
    // 若该生命周期调用 setState，甚至可能形成无限循环。
    const instance = workInProgress.stateNode;
    if (
      instance &&
      instance.__reactInternalMemoizedUnmaskedChildContext === unmaskedContext
    ) {
      return instance.__reactInternalMemoizedMaskedChildContext;
    }

    const context: {
      /** 组件在 contextTypes 中声明的键及对应值。 */
      [string]: $FlowFixMe
    } = {};
    for (const key in contextTypes) {
      context[key] = unmaskedContext[key];
    }

    // 缓存完整 Context，后续只在必要时重建掩码；Context 早于类实例创建，需先检查实例。
    if (instance) {
      cacheContext(workInProgress, unmaskedContext, context);
    }

    return context;
  }
}

/** 返回当前遗留 Context 栈是否包含一次需要向后代传播的变化。 */
function hasContextChanged(): boolean {
  if (disableLegacyContext) {
    return false;
  } else {
    return didPerformWorkStackCursor.current;
  }
}

/** 判断类组件类型是否通过 `childContextTypes` 声明遗留 Context provider。 */
function isContextProvider(type: Function): boolean {
  if (disableLegacyContext) {
    return false;
  } else {
    const childContextTypes = type.childContextTypes;
    return childContextTypes !== null && childContextTypes !== undefined;
  }
}

/** 离开类 provider 时弹出其遗留 Context 与变化标记。 */
function popContext(fiber: Fiber): void {
  if (disableLegacyContext) {
    return;
  } else {
    pop(didPerformWorkStackCursor, fiber);
    pop(contextStackCursor, fiber);
  }
}

/** 离开 HostRoot 时弹出顶层遗留 Context 与变化标记。 */
function popTopLevelContextObject(fiber: Fiber): void {
  if (disableLegacyContext) {
    return;
  } else {
    pop(didPerformWorkStackCursor, fiber);
    pop(contextStackCursor, fiber);
  }
}

/**
 * 在 HostRoot 入口压入应用提供的顶层遗留 Context。
 * 栈不为空表示嵌套协议出错；同时保存 didChange 供后代 bailout 判断。
 */
function pushTopLevelContextObject(
  fiber: Fiber,
  context: Object,
  didChange: boolean,
): void {
  if (disableLegacyContext) {
    return;
  } else {
    if (contextStackCursor.current !== emptyContextObject) {
      throw new Error(
        'Unexpected context found on stack. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }

    push(contextStackCursor, context, fiber);
    push(didPerformWorkStackCursor, didChange, fiber);
  }
}

/**
 * 调用 provider 实例的 `getChildContext`，校验返回键并与父 Context 合并。
 * 未实现方法时为兼容旧 Stack reconciler 只在开发期警告并继续使用父值。
 */
function processChildContext(
  fiber: Fiber,
  type: any,
  parentContext: Object,
): Object {
  if (disableLegacyContext) {
    return parentContext;
  } else {
    const instance = fiber.stateNode;
    const childContextTypes = type.childContextTypes;

    // TODO (bvaughn): 未来改为 invariant。当前仅为匹配 Stack reconciler 的意外行为。
    if (typeof instance.getChildContext !== 'function') {
      if (__DEV__) {
        const componentName = getComponentNameFromFiber(fiber) || 'Unknown';

        if (!warnedAboutMissingGetChildContext[componentName]) {
          warnedAboutMissingGetChildContext[componentName] = true;
          console.error(
            '%s.childContextTypes is specified but there is no getChildContext() method ' +
              'on the instance. You can either define getChildContext() on %s or remove ' +
              'childContextTypes from it.',
            componentName,
            componentName,
          );
        }
      }
      return parentContext;
    }

    const childContext = instance.getChildContext();
    for (const contextKey in childContext) {
      if (!(contextKey in childContextTypes)) {
        throw new Error(
          `${
            getComponentNameFromFiber(fiber) || 'Unknown'
          }.getChildContext(): key "${contextKey}" is not defined in childContextTypes.`,
        );
      }
    }

    return {...parentContext, ...childContext};
  }
}

/**
 * 在 provider begin 阶段尽早压入上次合并值或空占位，保持异常退栈完整。
 * 同时记住父 Context，并继承父 didPerformWork，避免无意阻断更新。
 */
function pushContextProvider(workInProgress: Fiber): boolean {
  if (disableLegacyContext) {
    return false;
  } else {
    const instance = workInProgress.stateNode;
    // 尽早压 Context 以保证栈完整；实例尚未创建时先压空值，invalidate 时再替换。
    const memoizedMergedChildContext =
      (instance && instance.__reactInternalMemoizedMergedChildContext) ||
      emptyContextObject;

    // 保存父 Context 供稍后合并，并继承父 did-perform-work 以免意外阻断更新。
    previousContext = contextStackCursor.current;
    push(contextStackCursor, memoizedMergedChildContext, workInProgress);
    push(
      didPerformWorkStackCursor,
      didPerformWorkStackCursor.current,
      workInProgress,
    );

    return true;
  }
}

/**
 * provider 实例可用后，用本次 `getChildContext` 结果替换早先占位。
 * didChange 为真时重新合并并标记变化；shouldComponentUpdate 阻止更新时只刷新变化
 * 标记，复用 memoized 合并值。
 */
function invalidateContextProvider(
  workInProgress: Fiber,
  type: any,
  didChange: boolean,
): void {
  if (disableLegacyContext) {
    return;
  } else {
    const instance = workInProgress.stateNode;

    if (!instance) {
      throw new Error(
        'Expected to have an instance by this point. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }

    if (didChange) {
      // 合并父 Context 与自身值；sCU 阻止更新时跳过，避免重算 memoized 值。
      const mergedContext = processChildContext(
        workInProgress,
        type,
        previousContext,
      );
      instance.__reactInternalMemoizedMergedChildContext = mergedContext;

      // 用新值替换旧值或占位；必须按入栈的反向顺序退栈。
      pop(didPerformWorkStackCursor, workInProgress);
      pop(contextStackCursor, workInProgress);
      // 压入新 Context 并标记已经变化。
      push(contextStackCursor, mergedContext, workInProgress);
      push(didPerformWorkStackCursor, didChange, workInProgress);
    } else {
      pop(didPerformWorkStackCursor, workInProgress);
      push(didPerformWorkStackCursor, didChange, workInProgress);
    }
  }
}

/**
 * 从给定 Fiber 向上寻找当前完整遗留 Context。
 * 仅供 `renderSubtreeIntoContainer` 等兼容入口：HostRoot 返回根 Context，最近类
 * provider 返回其 memoized 合并值；走出分离子树则报告内部错误。
 */
function findCurrentUnmaskedContext(fiber: Fiber): Object {
  if (disableLegacyContext) {
    return emptyContextObject;
  } else {
    // 当前只供 renderSubtreeIntoContainer 使用，其他场景是否合理尚不确定。
    let node: Fiber = fiber;
    do {
      switch (node.tag) {
        case HostRoot:
          return node.stateNode.context;
        case ClassComponent: {
          const Component = node.type;
          if (isContextProvider(Component)) {
            return node.stateNode.__reactInternalMemoizedMergedChildContext;
          }
          break;
        }
      }
      // $FlowFixMe[incompatible-type] 取得 null 时循环会退出。
      node = node.return;
    } while (node !== null);

    throw new Error(
      'Found unexpected detached subtree parent. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }
}

export {
  getUnmaskedContext,
  cacheContext,
  getMaskedContext,
  hasContextChanged,
  popContext,
  popTopLevelContextObject,
  pushTopLevelContextObject,
  processChildContext,
  isContextProvider,
  pushContextProvider,
  invalidateContextProvider,
  findCurrentUnmaskedContext,
};
