/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {canUseDOM} from 'shared/ExecutionEnvironment';

/**
 * 检测当前执行环境是否支持指定事件。
 * 
 * 注意：该方法无法正确检测 `change`、`reset`、`load`、`error`、`select` 等非通用事件。
 * 
 * 实现借鉴 Modernizr。
 * 
 * @param {string} eventNameSuffix 事件名后缀，例如“click”。
 * @return {boolean} 是否支持该事件。
 * @internal
 * @license Modernizr 3.0.0pre (Custom Build) | MIT
 */
/** isEventSupported 判断在 DOM 环境中检测指定原生事件是否受支持的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isEventSupported(eventNameSuffix: string): boolean {
  if (!canUseDOM) {
    return false;
  }

  const eventName = 'on' + eventNameSuffix;
  let isSupported = eventName in document;

  if (!isSupported) {
    const element = document.createElement('div');
    element.setAttribute(eventName, 'return;');
    isSupported = typeof (element as any)[eventName] === 'function';
  }

  return isSupported;
}

export default isEventSupported;
