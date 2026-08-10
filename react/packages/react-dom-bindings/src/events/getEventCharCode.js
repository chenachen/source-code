/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * `charCode` 表示真实字符编码，可安全传给 `String.fromCharCode`。
 * 因此只有可打印字符产生有效 `charCode`，Enter 是唯一例外。Tab 被视为不可打印键，
 * 因为浏览器中它不会生成制表字符。
 * 
 * @param {object} nativeEvent 原生浏览器事件。
 * @return {number} 归一化后的 `charCode`。
 */
/** getEventCharCode 查询并返回归一化键盘 charCode，过滤不可打印键并兼容回车差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
function getEventCharCode(nativeEvent: KeyboardEvent): number {
  let charCode;
  const keyCode = nativeEvent.keyCode;

  if ('charCode' in nativeEvent) {
    charCode = nativeEvent.charCode;

    // Firefox 不为 Enter 设置 `charCode`，因此回退检查 `keyCode`。
    if (charCode === 0 && keyCode === 13) {
      charCode = 13;
    }
  } else {
    // IE8 未实现 `charCode`，但 `keyCode` 的值正确。
    charCode = keyCode;
  }

  // Windows 上的 IE/Edge，以及 Windows/Linux 上的 Chrome/Safari
  // 在按住 Ctrl 时会把 Enter 报告为 charCode 10。
  if (charCode === 10) {
    charCode = 13;
  }

  // 部分不可打印键也会出现在 `charCode`/`keyCode` 中，需要丢弃。
  // 但不能丢弃特殊的 Enter 键。
  if (charCode >= 32 || charCode === 13) {
    return charCode;
  }

  return 0;
}

export default getEventCharCode;
