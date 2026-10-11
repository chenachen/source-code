/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {canUseDOM} from 'shared/ExecutionEnvironment';

export let passiveBrowserEventsSupported: boolean = false;

// 检测浏览器是否支持 passive 事件监听器。
// 参考：https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
if (canUseDOM) {
  try {
    const options: {
      /** 用 getter 探测 addEventListener 是否读取 passive 选项。 */
      passive?: void,
    } = {};
    Object.defineProperty(options, 'passive', {
      /** 浏览器读取 passive 选项时把 passiveBrowserEventsSupported 置 true。 */
      get: function () {
        passiveBrowserEventsSupported = true;
      },
    });
    window.addEventListener('test', options, options);
    window.removeEventListener('test', options, options);
  } catch (e) {
    passiveBrowserEventsSupported = false;
  }
}
