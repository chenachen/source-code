/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 */

import * as React from 'react';

/** 是否已经发出弃用警告，保证同一运行时只提示一次。 */
let didWarnAboutUsingAct = false;
/**
 * 兼容旧 `react-dom/test-utils` 的 act 导出，并把调用转交 `React.act`。
 * 首次调用会提示迁移；包装器不改变回调的调度或返回值语义。
 */
export function act(callback) {
  if (didWarnAboutUsingAct === false) {
    didWarnAboutUsingAct = true;
    console.error(
      '`ReactDOMTestUtils.act` is deprecated in favor of `React.act`. ' +
        'Import `act` from `react` instead of `react-dom/test-utils`. ' +
        'See https://react.dev/warnings/react-dom-test-utils for more info.',
    );
  }
  return React.act(callback);
}
