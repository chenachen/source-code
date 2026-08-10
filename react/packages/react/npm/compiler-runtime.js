/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

// React Compiler 发布入口按环境选择预构建 CJS，保持生成代码的导入路径稳定。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-compiler-runtime.production.js');
} else {
  module.exports = require('./cjs/react-compiler-runtime.development.js');
}
