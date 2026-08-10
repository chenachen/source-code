/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** 以“组件名.调用名”为键去重未挂载更新警告。 */
const didWarnStateUpdateForUnmountedComponent = {};

/** 对未挂载实例的更新调用发出一次警告，并保持操作为 no-op。 */
function warnNoop(publicInstance, callerName) {
  if (__DEV__) {
    const constructor = publicInstance.constructor;
    const componentName =
      (constructor && (constructor.displayName || constructor.name)) ||
      'ReactClass';
    const warningKey = `${componentName}.${callerName}`;
    if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
      return;
    }
    console.error(
      "Can't call %s on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the %s component.',
      callerName,
      componentName,
    );
    didWarnStateUpdateForUnmountedComponent[warningKey] = true;
  }
}

/**
 * 未挂载组件使用的更新队列默认实现；只报告误用，不保存任何待处理更新。
 */
const ReactNoopUpdateQueue = {
  /**
   * 对默认队列中的实例始终报告为未挂载。
   * @param {ReactClass} publicInstance - 待检查的公共实例。
   * @return {boolean} 固定为 `false`。
   * @protected
   * @final
   */
  isMounted: function (publicInstance) {
    return false;
  },

  /**
   * 拒绝为未挂载实例排入强制更新，并通过 `warnNoop` 报告调用。
   *
   * @param {ReactClass} publicInstance - 被请求更新的实例。
   * @param {?function} callback - 因无更新而不会执行的回调。
   * @param {?string} callerName - 公共 API 调用名。
   * @internal
   */
  enqueueForceUpdate: function (publicInstance, callback, callerName) {
    warnNoop(publicInstance, 'forceUpdate');
  },

  /**
   * 拒绝替换未挂载实例的完整状态，并通过 `warnNoop` 报告调用。
   *
   * @param {ReactClass} publicInstance - 被请求更新的实例。
   * @param {object} completeState - 不会入队的新状态。
   * @param {?function} callback - 因无更新而不会执行的回调。
   * @param {?string} callerName - 公共 API 调用名。
   * @internal
   */
  enqueueReplaceState: function (
    publicInstance,
    completeState,
    callback,
    callerName,
  ) {
    warnNoop(publicInstance, 'replaceState');
  },

  /**
   * 拒绝为未挂载实例合并局部状态，并通过 `warnNoop` 报告调用。
   *
   * @remarks 真正队列提供对内部 `_pendingState` 的浅合并；默认队列不持有该状态。
   * TODO：评估公开 pendingState 或停止在合并中依赖它。
   *
   * @param {ReactClass} publicInstance - 被请求更新的实例。
   * @param {object} partialState - 不会入队的局部状态。
   * @param {?function} callback - 因无更新而不会执行的回调。
   * @param {?string} callerName - 公共 API 调用名。
   * @internal
   */
  enqueueSetState: function (
    publicInstance,
    partialState,
    callback,
    callerName,
  ) {
    warnNoop(publicInstance, 'setState');
  },
};

export default ReactNoopUpdateQueue;
