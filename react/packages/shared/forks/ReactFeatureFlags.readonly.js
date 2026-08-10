/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// 仅供 bundle tests *读取* 默认 Feature Flags；测试无需变成内部测试也能判断是否处于 Fire mode。
/** 读取默认 Feature Flags 模块，供 bundle tests 判断构建模式；只读 bundle-test fork 通过 require('../ReactFeatureFlags') 读取默认值，随后由 Object.freeze 阻止写入。 */
const ReactFeatureFlags = require('../ReactFeatureFlags');
// 禁止写入，因为 bundle tests 无法可靠传播运行时修改。
module.exports = Object.freeze({...ReactFeatureFlags});
