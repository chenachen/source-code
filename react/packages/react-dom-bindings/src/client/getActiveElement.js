/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** `getActiveElement` 查询并返回所需值；缺失或不适用时走显式回退；用于在浏览器异常边界内安全读取活动元素。 */
export default function getActiveElement(doc: ?Document): ?Element {
  doc = doc || (typeof document !== 'undefined' ? document : undefined);
  if (typeof doc === 'undefined') {
    return null;
  }
  try {
    return doc.activeElement || doc.body;
  } catch (e) {
    return doc.body;
  }
}
