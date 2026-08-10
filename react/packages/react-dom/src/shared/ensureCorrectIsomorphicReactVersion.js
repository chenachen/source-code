/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import reactDOMPackageVersion from 'shared/ReactVersion';
import * as IsomorphicReactPackage from 'react';

/**
 * 确认 `react` 与 `react-dom` 版本完全一致，避免共享协议槽或元素格式不兼容。
 * 各 renderer 入口在开始工作前调用；不匹配时以稳定错误阻止继续执行。
 */
export function ensureCorrectIsomorphicReactVersion() {
  const isomorphicReactPackageVersion = IsomorphicReactPackage.version;
  if (isomorphicReactPackageVersion !== reactDOMPackageVersion) {
    throw new Error(
      'Incompatible React versions: The "react" and "react-dom" packages must ' +
        'have the exact same version. Instead got:\n' +
        `  - react:      ${isomorphicReactPackageVersion}\n` +
        `  - react-dom:  ${reactDOMPackageVersion}\n` +
        'Learn more: https://react.dev/warnings/version-mismatch',
    );
  }
}
