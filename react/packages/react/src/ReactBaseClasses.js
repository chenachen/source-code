/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ReactNoopUpdateQueue from './ReactNoopUpdateQueue';
import assign from 'shared/assign';

/** 所有新实例共享的空 refs 占位；DEV 冻结后可暴露错误写入。 */
const emptyObject = {};
if (__DEV__) {
  Object.freeze(emptyObject);
}

/**
 * 初始化类组件公共实例，并接入 renderer 提供的更新队列。
 *
 * @remarks 未挂载时使用 no-op 队列；挂载阶段 reconciler 会注入真实 updater。
 */
function Component(props, context, updater) {
  this.props = props;
  this.context = context;
  // 若组件使用字符串 ref，renderer 会在后续阶段替换此对象。
  this.refs = emptyObject;
  // 默认队列只负责未挂载警告；真实更新队列由 renderer 注入。
  this.updater = updater || ReactNoopUpdateQueue;
}

Component.prototype.isReactComponent = {};

/**
 * 把局部状态或状态计算函数交给 updater 排队。
 *
 * @remarks `this.state` 应视为不可变快照；调用可能被批处理，因而不会保证同步更新。
 * 函数式更新收到执行时最新的 state、props、context，这些值可能尚未写回实例字段。
 *
 * @param {object|function} partialState - 待合并的局部状态，或根据最新状态计算它的函数。
 * @param {?function} callback - 实际提交更新后调用的回调。
 * @final
 * @protected
 */
Component.prototype.setState = function (partialState, callback) {
  if (
    typeof partialState !== 'object' &&
    typeof partialState !== 'function' &&
    partialState != null
  ) {
    throw new Error(
      'takes an object of state variables to update or a ' +
        'function which returns an object of state variables.',
    );
  }

  this.updater.enqueueSetState(this, partialState, callback, 'setState');
};

/**
 * 绕过 `shouldComponentUpdate` 请求一次强制更新。
 *
 * @remarks 适用于 React 状态之外的深层数据已变化、且当前不在 DOM 事务中的场景；
 * 生命周期更新钩子仍会执行。
 *
 * @param {?function} callback - 更新提交完成后的回调。
 * @final
 * @protected
 */
Component.prototype.forceUpdate = function (callback) {
  this.updater.enqueueForceUpdate(this, callback, 'forceUpdate');
};

/**
 * 经典 React class 曾提供这些 API；现代基类不再实现它们，只安装访问即告警的 getter。
 */
if (__DEV__) {
  const deprecatedAPIs = {
    isMounted: [
      'isMounted',
      'Instead, make sure to clean up subscriptions and pending requests in ' +
        'componentWillUnmount to prevent memory leaks.',
    ],
    replaceState: [
      'replaceState',
      'Refactor your code to use setState instead (see ' +
        'https://github.com/facebook/react/issues/3236).',
    ],
  };
  /** 为一个废弃实例属性安装只读告警 getter。 */
  const defineDeprecationWarning = function (methodName, info) {
    Object.defineProperty(Component.prototype, methodName, {
      /** 报告废弃访问并返回 `undefined`，避免伪装成仍可调用的方法。 */
      get: function () {
        console.warn(
          '%s(...) is deprecated in plain JavaScript React classes. %s',
          info[0],
          info[1],
        );
        return undefined;
      },
    });
  };
  for (const fnName in deprecatedAPIs) {
    if (deprecatedAPIs.hasOwnProperty(fnName)) {
      defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
    }
  }
}

/** 建立 PureComponent 原型链时使用，避免执行 `Component` 构造逻辑。 */
function ComponentDummy() {}
ComponentDummy.prototype = Component.prototype;

/**
 * 初始化 PureComponent 公共实例；浅比较能力由原型标记通知 reconciler。
 */
function PureComponent(props, context, updater) {
  this.props = props;
  this.context = context;
  // 若组件使用字符串 ref，renderer 会在后续阶段替换此对象。
  this.refs = emptyObject;
  this.updater = updater || ReactNoopUpdateQueue;
}

/** 继承 Component API、并承载 pure 标记的共享原型。 */
const pureComponentPrototype = (PureComponent.prototype = new ComponentDummy());
pureComponentPrototype.constructor = PureComponent;
// 直接复制方法，避免每次查找再跨一层原型。
assign(pureComponentPrototype, Component.prototype);
pureComponentPrototype.isPureReactComponent = true;

export {Component, PureComponent};
