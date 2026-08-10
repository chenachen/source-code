/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from './DOMEventNames';

import {enableCreateEventHandleAPI} from 'shared/ReactFeatureFlags';

/** allNativeEvents 保存维护 registration name、原生依赖与可能事件名的全局注册表所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const allNativeEvents: Set<DOMEventName> = new Set();

if (enableCreateEventHandleAPI) {
  allNativeEvents.add('beforeblur');
  allNativeEvents.add('afterblur');
}

/**
 * registration name 到原生事件名的映射。
 */
/** registrationNameDependencies 保存维护 registration name、原生依赖与可能事件名的全局注册表所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const registrationNameDependencies: {
  /** registrationName 描述维护 registration name、原生依赖与可能事件名的全局注册表的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  [registrationName: string]: Array<DOMEventName>,
} = {};

/**
 * 小写 registration name 到正确大小写名称的映射，
 * 用于在事件 handler 拼写错误时给出警告；仅在 __DEV__ 可用。
 * @type {Object}
 */
/** possibleRegistrationNames 保存维护 registration name、原生依赖与可能事件名的全局注册表所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const possibleRegistrationNames: {
  /** lowerCasedName 描述维护 registration name、原生依赖与可能事件名的全局注册表的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  [lowerCasedName: string]: string,
} = __DEV__ ? {} : (null as any);
// 只信任开发者在 __DEV__ 中访问 possibleRegistrationNames。

/** registerTwoPhaseEvent 管理维护 registration name、原生依赖与可能事件名的全局注册表的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function registerTwoPhaseEvent(
  registrationName: string,
  dependencies: Array<DOMEventName>,
): void {
  registerDirectEvent(registrationName, dependencies);
  registerDirectEvent(registrationName + 'Capture', dependencies);
}

/** registerDirectEvent 管理维护 registration name、原生依赖与可能事件名的全局注册表的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function registerDirectEvent(
  registrationName: string,
  dependencies: Array<DOMEventName>,
) {
  if (__DEV__) {
    if (registrationNameDependencies[registrationName]) {
      console.error(
        'EventRegistry: More than one plugin attempted to publish the same ' +
          'registration name, `%s`.',
        registrationName,
      );
    }
  }

  registrationNameDependencies[registrationName] = dependencies;

  if (__DEV__) {
    const lowerCasedName = registrationName.toLowerCase();
    possibleRegistrationNames[lowerCasedName] = registrationName;

    if (registrationName === 'onDoubleClick') {
      possibleRegistrationNames.ondblclick = registrationName;
    }
  }

  for (let i = 0; i < dependencies.length; i++) {
    allNativeEvents.add(dependencies[i]);
  }
}
