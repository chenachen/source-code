/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

let didWarnAboutMessageChannel = false;
let enqueueTaskImpl = null;

/**
 * 把 callback 放入不受常见 fake timer 影响的宿主 task。
 *
 * @remarks 首次调用惰性选择 Node 原生 `setImmediate`，浏览器则使用 MessageChannel；
 * `require` 名称动态构造，避免 bundler 注入 Node polyfill。
 */
export default function enqueueTask(task: () => void): void {
  if (enqueueTaskImpl === null) {
    try {
      // 从 module 动态读取 require，避免 bundler 静态检测并打入 Node polyfill。
      const requireString = ('require' + Math.random()).slice(0, 7);
      // $FlowFixMe[invalid-computed-prop]
      const nodeRequire = module && module[requireString];
      // Node 路径直接取 timers.setImmediate，绕过可能被测试框架替换的全局 timer。
      enqueueTaskImpl = nodeRequire.call(module, 'timers').setImmediate;
    } catch (_err) {
      // 浏览器普通 timer 也可能被 fake，改用 MessageChannel + postMessage。
      /** 为浏览器创建一次性 MessageChannel task。 */
      enqueueTaskImpl = function (callback: () => void) {
        if (__DEV__) {
          if (didWarnAboutMessageChannel === false) {
            didWarnAboutMessageChannel = true;
            if (typeof MessageChannel === 'undefined') {
              console.error(
                'This browser does not have a MessageChannel implementation, ' +
                  'so enqueuing tasks via await act(async () => ...) will fail. ' +
                  'Please file an issue at https://github.com/facebook/react/issues ' +
                  'if you encounter this warning.',
              );
            }
          }
        }
        const channel = new MessageChannel();
        channel.port1.onmessage = callback;
        channel.port2.postMessage(undefined);
      };
    }
  }
  return enqueueTaskImpl(task);
}
