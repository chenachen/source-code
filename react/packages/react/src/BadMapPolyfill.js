/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

/** DEV 环境是否检测到无法以冻结对象为键的 Map/Set polyfill。 */
export let hasBadMapPolyfill: boolean;

if (__DEV__) {
  hasBadMapPolyfill = false;
  try {
    const frozenObject = Object.freeze({});
    /* eslint-disable no-new */
    new Map([[frozenObject, null]]);
    new Set([frozenObject]);
    /* eslint-enable no-new */
  } catch (e) {
    // TODO：评估是否应向应用开发者提示不兼容的 polyfill。
    hasBadMapPolyfill = true;
  }
}
