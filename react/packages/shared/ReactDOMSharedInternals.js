/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as ReactDOM from 'react-dom';

/** ReactDOM 包注入的私有 host dispatcher、优先级与 `findDOMNode` 桥。 */
const ReactDOMSharedInternals =
  ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

export default ReactDOMSharedInternals;
