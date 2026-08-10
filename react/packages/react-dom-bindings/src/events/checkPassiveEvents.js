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
      /** passive 描述探测浏览器是否读取事件监听选项，从而安全启用 passive listener的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
      passive?: void,
    } = {};
    Object.defineProperty(options, 'passive', {
      /** get 是探测浏览器是否读取事件监听选项，从而安全启用 passive listener的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
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
