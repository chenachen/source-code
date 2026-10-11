/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** 以“组件名.调用名”为键去重未挂载更新警告。 */
const didWarnStateUpdateForUnmountedComponent = {};

/**
 * 对默认 no-op updater 上的调用按“组件名.方法名”发出一次 DEV 警告。
 * @param publicInstance - 由 Component/PureComponent 构造且尚未注入真实 updater 的实例。
 * @param callerName - 此队列固定传入 setState/replaceState/forceUpdate，而非透传入口附带名称。
 * @remarks 同名类共享去重键，模块缓存持续保留警告记录；不按实例或 Fiber 保存更新，
 * 也不检测实例实际是否曾经挂载。生产路径无警告副作用，callback 不会被执行。
 */
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
   * @param {?string} callerName - 兼容 updater 协议的调用名；当前实现忽略并使用固定方法名。
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
   * @param {?string} callerName - 兼容 updater 协议的调用名；当前实现忽略并使用固定方法名。
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
   * @remarks 默认队列不持有状态。挂载后的 reconciler 把更新存入 Fiber.updateQueue，
   * 在 render 阶段依次计算状态补丁并与前一状态浅合并。
   *
   * @param {ReactClass} publicInstance - 被请求更新的实例。
   * @param {object} partialState - 不会入队的局部状态。
   * @param {?function} callback - 因无更新而不会执行的回调。
   * @param {?string} callerName - 兼容 updater 协议的调用名；当前实现忽略并使用固定方法名。
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
