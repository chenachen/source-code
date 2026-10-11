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

/** 全部已注册插件依赖的原生事件名；根监听按此集合安装。 */
export const allNativeEvents: Set<DOMEventName> = new Set();

if (enableCreateEventHandleAPI) {
  allNativeEvents.add('beforeblur');
  allNativeEvents.add('afterblur');
}

/**
 * registration name 到原生事件名的映射。
 */
/** React on* 名称到原生依赖列表的注册表。 */
export const registrationNameDependencies: {
  /** React handler 名，值为该 handler 依赖的原生事件数组。 */
  [registrationName: string]: Array<DOMEventName>,
} = {};

/**
 * 小写 registration name 到正确大小写名称的映射，
 * 用于在事件 handler 拼写错误时给出警告；仅在 __DEV__ 可用。
 * @type {Object}
 */
/** 开发期小写 handler 名到正确大小写的映射，用于拼写建议。 */
export const possibleRegistrationNames: {
  /** 小写 handler 名，值为正确的 React onXxx 拼写。 */
  [lowerCasedName: string]: string,
} = __DEV__ ? {} : (null as any);
// 只信任开发者在 __DEV__ 中访问 possibleRegistrationNames。

/** 为同一组原生依赖登记 onXxx 和 onXxxCapture 两个 React 名称。 */
export function registerTwoPhaseEvent(
  registrationName: string,
  dependencies: Array<DOMEventName>,
): void {
  registerDirectEvent(registrationName, dependencies);
  registerDirectEvent(registrationName + 'Capture', dependencies);
}

/** 登记一个 React 名的原生依赖，并把依赖加入 allNativeEvents；不在 DOM 上安装 listener。 */
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
